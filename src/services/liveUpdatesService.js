import {
  AUTO_REFRESH_TAB_ID,
  publishAutoRefresh,
  setLiveUpdatesHealthy,
} from "../components/auto/autorefreshconfig";
import { getChangeFeed } from "./api";

/**
 * Server-mediated live refresh, over long polling.
 *
 * The browser already syncs itself: a mutation publishes an auto-refresh event and BroadcastChannel
 * relays it to the other tabs. But that never leaves the machine. When HR approves a leave on their
 * computer, the employee's browser has no idea anything happened.
 *
 * This closes that gap. A request to `changes.php` is left parked on the server until a topic's
 * revision actually moves, and the moment one does the response comes back and this republishes the
 * matching auto-refresh event. Every screen already listening for those events reloads itself, so no
 * screen needs to know this exists.
 *
 * Long polling rather than a short interval because the two costs pull apart: a short interval buys
 * latency with request volume, and each request pays for a full scan of the tables behind every
 * topic. Parking the request instead pushes the waiting onto the server, where it can watch far more
 * cheaply than the client can ask — an approval lands in a couple of seconds while an idle system
 * exchanges roughly one request per 25 seconds.
 *
 * Two rules keep that affordable on XAMPP, where a held request occupies an Apache worker thread for
 * its whole life:
 *   - one connection per browser, not per tab. Tabs elect a leader; the leader polls and publishes
 *     across BroadcastChannel, and the others read that for free.
 *   - nothing is held while the tab is hidden. A backgrounded tab releases both the connection and
 *     its leadership, and the screens it holds refresh on focus anyway.
 */

/**
 * Shared hosting (the InfinityFree build) caps concurrent PHP processes and CPU time, and a parked
 * request spends both for its whole hold. Setting REACT_APP_LIVE_UPDATES_POLL_SECONDS at build time
 * switches to plain polling: ask for no hold, get an answer at once, wait that many seconds. Unset —
 * XAMPP, `npm start`, the normal build — it is 0 and the long poll below is unchanged.
 */
const POLL_SECONDS = Math.max(0, Number(process.env.REACT_APP_LIVE_UPDATES_POLL_SECONDS) || 0);
/** Must stay at or under the server's own cap, or every request would be cut short of its hold. */
const HOLD_SECONDS = POLL_SECONDS > 0 ? 0 : 25;
/** A breath between reconnects, so a server answering instantly cannot spin this into a tight loop. */
const RECONNECT_DELAY_MS = POLL_SECONDS > 0 ? POLL_SECONDS * 1000 : 250;
const MIN_BACKOFF_MS = 2000;
/** Errors back off so a dead backend is not hammered for the whole session. */
const MAX_BACKOFF_MS = 60000;

const LEADER_STORAGE_KEY = "hris:live-updates:leader";
const LEADER_HEARTBEAT_MS = 3000;
/**
 * Three missed heartbeats. Long enough that a leader stalled behind a slow render is not deposed
 * mid-flight, short enough that closing the leader tab does not leave the others unfed for long.
 */
const LEADER_STALE_MS = 9000;
const FOLLOWER_RETRY_MS = 4000;

let running = false;
/** Bumped to retire a loop. A loop compares it after every await and returns if it no longer owns it. */
let loopToken = 0;
let inFlightController = null;
let heartbeatTimerId = null;
let isLeader = false;
let cursor = "";
/** null until the first successful poll — the baseline must not be reported as change. */
let lastRevisions = null;
let consecutiveFailures = 0;

function isVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isAbortError(error) {
  return error?.code === "ERR_CANCELED"
    || error?.name === "CanceledError"
    || error?.name === "AbortError";
}

function backoffDelayMs() {
  return Math.min(MIN_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1), MAX_BACKOFF_MS);
}

function abortInFlight() {
  if (inFlightController) {
    try {
      inFlightController.abort();
    } catch {
      // Already settled; nothing to release.
    }

    inFlightController = null;
  }
}

function readLeaderRecord() {
  try {
    const raw = window.localStorage.getItem(LEADER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLeaderRecord() {
  try {
    window.localStorage.setItem(
      LEADER_STORAGE_KEY,
      JSON.stringify({ tabId: AUTO_REFRESH_TAB_ID, at: Date.now() })
    );
  } catch {
    /*
     * Private or restricted modes have no localStorage, so leadership cannot be coordinated and
     * `claimLeadership` will let every tab through. That degrades to one connection per tab — more
     * server threads than intended, but still correct.
     */
  }
}

function leaderIsFresh(record) {
  return Boolean(record) && Date.now() - Number(record?.at || 0) < LEADER_STALE_MS;
}

/**
 * Two tabs can briefly both believe they lead — localStorage has no compare-and-set — and that is
 * deliberately tolerated. The cost is one redundant connection until the next heartbeat settles it;
 * the cost of preventing it is a locking protocol between tabs that can deadlock and leave nobody
 * polling at all.
 */
function claimLeadership() {
  const record = readLeaderRecord();

  if (record && record.tabId !== AUTO_REFRESH_TAB_ID && leaderIsFresh(record)) {
    isLeader = false;
    return false;
  }

  writeLeaderRecord();
  isLeader = true;

  return true;
}

function releaseLeadership() {
  if (!isLeader) {
    return;
  }

  isLeader = false;

  try {
    const record = readLeaderRecord();

    // Only clear our own claim: another tab may have taken over already.
    if (record && record.tabId === AUTO_REFRESH_TAB_ID) {
      window.localStorage.removeItem(LEADER_STORAGE_KEY);
    }
  } catch {
    // Nothing to clear.
  }
}

function stopHeartbeat() {
  if (heartbeatTimerId !== null) {
    window.clearInterval(heartbeatTimerId);
    heartbeatTimerId = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();

  /*
   * On its own timer rather than after each response: a leader parked on a 25s hold would otherwise
   * look stale for most of every hold and be deposed by a follower on a loop of its own.
   */
  heartbeatTimerId = window.setInterval(() => {
    if (isLeader) {
      writeLeaderRecord();
    }
  }, LEADER_HEARTBEAT_MS);
}

function changedTopics(previous, next) {
  return Object.keys(next).filter((topic) => previous[topic] !== next[topic]);
}

function applyRevisions(revisions) {
  if (lastRevisions === null) {
    lastRevisions = revisions;
    return;
  }

  const topics = changedTopics(lastRevisions, revisions);
  lastRevisions = revisions;

  topics.forEach((topic) => {
    /*
     * `broadcast: true` is the whole point of electing a leader: this tab did the asking, and the
     * relay is how the other tabs of this browser learn the answer without each holding a connection
     * of their own.
     */
    publishAutoRefresh({
      broadcast: true,
      dispatchLegacy: true,
      source: "server",
      topic,
    });
  });
}

async function runLoop(token) {
  while (running && token === loopToken) {
    /*
     * A hidden tab holds nothing. It gives up its leadership so a visible tab elsewhere can take
     * over, and lets the loop end — `handleWake` starts a fresh one when the tab comes back.
     */
    if (!isVisible()) {
      releaseLeadership();
      return;
    }

    if (!claimLeadership()) {
      /*
       * Being a follower is not being stale: the leader publishes across BroadcastChannel and this
       * tab's screens refresh from that. Health therefore tracks the leader's heartbeat, so the
       * per-screen fallback timers stay relaxed here too.
       */
      setLiveUpdatesHealthy(leaderIsFresh(readLeaderRecord()));
      await sleep(FOLLOWER_RETRY_MS);
      continue;
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    inFlightController = controller;

    try {
      const payload = await getChangeFeed({
        cursor,
        holdSeconds: HOLD_SECONDS,
        signal: controller ? controller.signal : undefined,
      });

      if (!running || token !== loopToken) {
        return;
      }

      const revisions = payload?.revisions;

      if (!revisions || typeof revisions !== "object") {
        throw new Error("Change feed returned no revisions.");
      }

      cursor = String(payload.cursor || "");
      consecutiveFailures = 0;
      setLiveUpdatesHealthy(true);
      applyRevisions(revisions);

      await sleep(RECONNECT_DELAY_MS);
    } catch (error) {
      if (!running || token !== loopToken) {
        return;
      }

      // Hidden, signed out, or superseded by a newer loop — the top of the loop decides what next.
      if (isAbortError(error)) {
        continue;
      }

      if (error?.response?.status === 401) {
        /*
         * The session is gone and the response interceptor has already told the app. Reconnecting
         * would mean a 401 every 25 seconds for as long as this tab stays open.
         */
        stopLiveUpdates();
        return;
      }

      consecutiveFailures += 1;
      setLiveUpdatesHealthy(false);
      await sleep(backoffDelayMs());
    } finally {
      if (inFlightController === controller) {
        inFlightController = null;
      }
    }
  }
}

function restartLoop() {
  /*
   * Retire the current loop before starting the next. Bumping the token alone would leave the old
   * loop parked on its hold for up to 25 more seconds, holding a second server thread the whole
   * time; aborting makes it fail fast and see that it no longer owns the token.
   */
  abortInFlight();
  loopToken += 1;
  void runLoop(loopToken);
}

/** Reconnect the moment the tab is usable again, so a returning user never reads stale statuses. */
function handleWake() {
  if (!running) {
    return;
  }

  if (!isVisible()) {
    // Free the thread now rather than at the end of the hold.
    abortInFlight();
    return;
  }

  consecutiveFailures = 0;
  restartLoop();
}

function handleUnload() {
  releaseLeadership();
}

export function startLiveUpdates() {
  if (typeof window === "undefined" || running) {
    return;
  }

  running = true;
  cursor = "";
  lastRevisions = null;
  consecutiveFailures = 0;

  document.addEventListener("visibilitychange", handleWake);
  window.addEventListener("focus", handleWake);
  window.addEventListener("online", handleWake);
  window.addEventListener("beforeunload", handleUnload);

  startHeartbeat();
  restartLoop();
}

export function stopLiveUpdates() {
  if (typeof window === "undefined" || !running) {
    return;
  }

  running = false;
  loopToken += 1;
  abortInFlight();
  stopHeartbeat();
  releaseLeadership();
  setLiveUpdatesHealthy(false);

  cursor = "";
  lastRevisions = null;
  consecutiveFailures = 0;

  document.removeEventListener("visibilitychange", handleWake);
  window.removeEventListener("focus", handleWake);
  window.removeEventListener("online", handleWake);
  window.removeEventListener("beforeunload", handleUnload);
}
