import { publishAutoRefresh } from "../components/auto/autorefreshconfig";
import { getChangeFeed } from "./api";

/**
 * Server-mediated live refresh.
 *
 * The browser already syncs itself: a mutation publishes an auto-refresh event, and BroadcastChannel
 * relays it to other tabs. But that never leaves the machine. When HR approves a leave on their
 * computer, the employee's browser has no idea anything happened.
 *
 * This closes that gap the cheap way: poll `changes.php` for a revision string per topic and, when
 * one moves, publish the auto-refresh event for that topic. Every screen already listening for those
 * events reloads itself, so no screen needs to know this exists.
 */

/**
 * Short enough that an approval on one machine lands on another before the person watching decides
 * to reload by hand. The tab-switch case is already instant — `handleWake` polls on focus — so this
 * only paces the case where both windows are visible at once.
 */
const DEFAULT_INTERVAL_MS = 6000;
/** Errors back off so a dead backend is not hammered every 10s for the whole session. */
const MAX_INTERVAL_MS = 120000;

let pollTimerId = null;
let running = false;
let inFlight = false;
let intervalMs = DEFAULT_INTERVAL_MS;
let consecutiveFailures = 0;
/** null until the first successful poll — the baseline must not be reported as change. */
let lastRevisions = null;

function isVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function currentDelay() {
  if (consecutiveFailures === 0) {
    return intervalMs;
  }

  return Math.min(intervalMs * 2 ** consecutiveFailures, MAX_INTERVAL_MS);
}

function scheduleNextPoll() {
  if (!running) {
    return;
  }

  window.clearTimeout(pollTimerId);
  pollTimerId = window.setTimeout(runPoll, currentDelay());
}

function changedTopics(previous, next) {
  return Object.keys(next).filter((topic) => previous[topic] !== next[topic]);
}

async function runPoll() {
  if (!running || inFlight || !isVisible()) {
    scheduleNextPoll();
    return;
  }

  inFlight = true;

  try {
    const payload = await getChangeFeed();
    const revisions = payload?.revisions;

    if (!revisions || typeof revisions !== "object") {
      throw new Error("Change feed returned no revisions.");
    }

    consecutiveFailures = 0;

    if (lastRevisions === null) {
      lastRevisions = revisions;
    } else {
      const topics = changedTopics(lastRevisions, revisions);
      lastRevisions = revisions;

      topics.forEach((topic) => {
        publishAutoRefresh({
          broadcast: false,
          dispatchLegacy: true,
          source: "server",
          topic,
        });
      });
    }
  } catch {
    // A failed poll is not worth surfacing — the next one either recovers or backs off further.
    consecutiveFailures += 1;
  } finally {
    inFlight = false;
    scheduleNextPoll();
  }
}

/** Poll immediately when the tab comes back, so a returning user never reads stale statuses. */
function handleWake() {
  if (!running || !isVisible()) {
    return;
  }

  window.clearTimeout(pollTimerId);
  pollTimerId = window.setTimeout(runPoll, 0);
}

export function startLiveUpdates({ intervalMs: requestedInterval } = {}) {
  if (typeof window === "undefined" || running) {
    return;
  }

  running = true;
  intervalMs = Math.max(3000, Number(requestedInterval) || DEFAULT_INTERVAL_MS);
  consecutiveFailures = 0;
  lastRevisions = null;

  document.addEventListener("visibilitychange", handleWake);
  window.addEventListener("focus", handleWake);
  window.addEventListener("online", handleWake);

  runPoll();
}

export function stopLiveUpdates() {
  if (typeof window === "undefined" || !running) {
    return;
  }

  running = false;
  window.clearTimeout(pollTimerId);
  pollTimerId = null;
  lastRevisions = null;
  consecutiveFailures = 0;

  document.removeEventListener("visibilitychange", handleWake);
  window.removeEventListener("focus", handleWake);
  window.removeEventListener("online", handleWake);
}
