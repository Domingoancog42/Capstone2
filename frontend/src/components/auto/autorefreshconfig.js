export const AUTO_REFRESH_EVENT = "hris:auto-refresh";
export const AUTO_REFRESH_CHANNEL_NAME = "hris:auto-refresh";
export const AUTO_REFRESH_STORAGE_KEY = "hris:auto-refresh:last-event";
export const AUTO_REFRESH_DEBOUNCE_MS = 250;
export const AUTO_REFRESH_FALLBACK_INTERVAL_MS = 10000;
/**
 * The safety-net interval used while the long-poll feed is delivering.
 *
 * Server-side changes arrive over the feed within seconds, so the per-screen timer stops being the
 * thing that keeps a screen current and becomes a backstop against the feed having gone quiet
 * without saying so. A minute is frequent enough to be that backstop and infrequent enough that the
 * two mechanisms together cost less than the 10s timer did on its own.
 */
export const AUTO_REFRESH_LIVE_INTERVAL_MS = 60000;
export const AUTO_REFRESH_ALL_TOPIC = "*";
export const LIVE_UPDATES_HEALTH_EVENT = "hris:live-updates:health";

const AUTO_REFRESH_TAB_STORAGE_KEY = "hris:auto-refresh:tab-id";
const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);
const EXCLUDED_ENDPOINTS = [
  "/login.php",
  "/logout.php",
  "/forgot_password.php",
  "/reset_password.php",
  "/public_settings.php",
  "/session.php",
];

/**
 * Screens written before topics existed listen for these window events instead. Publishing a topic
 * re-fires them so those screens keep refreshing without being rewritten. Screens added since then
 * subscribe to topics directly via `useAutoRefreshOnChange` and need no entry here.
 */
const LEGACY_TOPIC_EVENTS = {
  notifications: ["hris:notifications:changed"],
  attendance: ["attendance:changed"],
  attendance_adjustments: ["attendance:changed"],
  attendance_daily_records: ["attendance:changed"],
  attendance_logs: ["attendance:changed"],
  compensatory: ["leave-requests:changed"],
  leave_credit: ["leave-requests:changed"],
  leave_monetization: ["leave-monetization:changed"],
  leave_request: ["leave-requests:changed"],
  loan: ["loan-requests:changed"],
  loan_request: ["loan-requests:changed"],
  loan_request_audit_trail: ["loan-requests:changed"],
  overtime: ["leave-requests:changed"],
  pass_slip: ["leave-requests:changed"],
  travel_order: ["leave-requests:changed"],
};

let sharedChannel = null;
let bridgeStarted = false;
let liveUpdatesHealthy = false;
const recentExternalEventIds = new Set();

function makeId(prefix = "sync") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTabId() {
  if (typeof window === "undefined") {
    return "server";
  }

  try {
    const current = window.sessionStorage.getItem(AUTO_REFRESH_TAB_STORAGE_KEY);
    if (current) {
      return current;
    }

    const next = makeId("tab");
    window.sessionStorage.setItem(AUTO_REFRESH_TAB_STORAGE_KEY, next);
    return next;
  } catch {
    return makeId("tab");
  }
}

export const AUTO_REFRESH_TAB_ID = getTabId();

function parsePayload(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return typeof value === "object" ? value : null;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeAutoRefreshTopic(topic = AUTO_REFRESH_ALL_TOPIC) {
  const value = String(topic || AUTO_REFRESH_ALL_TOPIC).trim().toLowerCase();

  if (!value || value === AUTO_REFRESH_ALL_TOPIC) {
    return AUTO_REFRESH_ALL_TOPIC;
  }

  return value
    .replace(/\.php$/i, "")
    .replace(/[^a-z0-9*]+/g, "_")
    .replace(/^_+|_+$/g, "") || AUTO_REFRESH_ALL_TOPIC;
}

export function normalizeAutoRefreshTopics(topics = []) {
  const source = Array.isArray(topics) ? topics : [topics];
  const normalized = source.map(normalizeAutoRefreshTopic);

  return unique(normalized.length ? normalized : [AUTO_REFRESH_ALL_TOPIC]);
}

export function topicFromRequestUrl(url = "") {
  const rawUrl = String(url || "");

  if (!rawUrl) {
    return AUTO_REFRESH_ALL_TOPIC;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsedUrl = new URL(rawUrl, base);
    const filename = parsedUrl.pathname.split("/").filter(Boolean).pop() || "";
    return normalizeAutoRefreshTopic(filename || rawUrl);
  } catch {
    const [pathOnly] = rawUrl.split("?");
    const filename = pathOnly.split("/").filter(Boolean).pop() || pathOnly;
    return normalizeAutoRefreshTopic(filename);
  }
}

function requestPathFromConfig(config = {}) {
  const url = String(config?.url || "");

  try {
    const base = String(config?.baseURL || (typeof window !== "undefined" ? window.location.origin : "http://localhost"));
    return new URL(url, base).pathname.toLowerCase();
  } catch {
    return url.split("?")[0].toLowerCase();
  }
}

export function shouldPublishAutoRefreshForRequest(config = {}) {
  const method = String(config?.method || "get").toLowerCase();

  if (!MUTATION_METHODS.has(method)) {
    return false;
  }

  const requestPath = requestPathFromConfig(config);
  return !EXCLUDED_ENDPOINTS.some((endpoint) => requestPath.endsWith(endpoint));
}

export function createAutoRefreshPayload(payload = {}) {
  const primaryTopic = normalizeAutoRefreshTopic(
    payload.topic || topicFromRequestUrl(payload.url || payload.sourceUrl || "")
  );
  const topics = normalizeAutoRefreshTopics([
    primaryTopic,
    ...(Array.isArray(payload.topics) ? payload.topics : []),
  ]);

  return {
    ...payload,
    id: payload.id || payload.eventId || makeId("refresh"),
    topic: topics[0] || AUTO_REFRESH_ALL_TOPIC,
    topics,
    source: payload.source || "client",
    sourceTabId: payload.sourceTabId || AUTO_REFRESH_TAB_ID,
    at: payload.at || new Date().toISOString(),
  };
}

export function normalizeAutoRefreshPayload(payload = {}) {
  const parsed = parsePayload(payload);

  if (!parsed) {
    return null;
  }

  return createAutoRefreshPayload(parsed);
}

export function autoRefreshTopicMatches(payloadTopics = [], watchedTopics = []) {
  const normalizedPayloadTopics = normalizeAutoRefreshTopics(payloadTopics);
  const normalizedWatchedTopics = normalizeAutoRefreshTopics(watchedTopics.length ? watchedTopics : [AUTO_REFRESH_ALL_TOPIC]);

  if (
    normalizedPayloadTopics.includes(AUTO_REFRESH_ALL_TOPIC)
    || normalizedWatchedTopics.includes(AUTO_REFRESH_ALL_TOPIC)
  ) {
    return true;
  }

  return normalizedPayloadTopics.some((topic) => normalizedWatchedTopics.includes(topic));
}

function getBroadcastChannel() {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }

  if (!sharedChannel) {
    sharedChannel = new BroadcastChannel(AUTO_REFRESH_CHANNEL_NAME);
  }

  return sharedChannel;
}

function rememberExternalEvent(id) {
  if (!id || recentExternalEventIds.has(id)) {
    return false;
  }

  recentExternalEventIds.add(id);

  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      recentExternalEventIds.delete(id);
    }, 30000);
  }

  return true;
}

function dispatchLegacyEvents(payload) {
  if (typeof window === "undefined") {
    return;
  }

  const eventNames = new Set();
  normalizeAutoRefreshTopics(payload.topics || payload.topic).forEach((topic) => {
    (LEGACY_TOPIC_EVENTS[topic] || []).forEach((eventName) => eventNames.add(eventName));
  });

  eventNames.forEach((eventName) => {
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  });
}

function dispatchLocalAutoRefresh(payload, { dispatchLegacy = true } = {}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTO_REFRESH_EVENT, { detail: payload }));

  if (dispatchLegacy) {
    dispatchLegacyEvents(payload);
  }
}

function handleExternalAutoRefresh(payload) {
  const normalizedPayload = normalizeAutoRefreshPayload(payload);

  if (!normalizedPayload || normalizedPayload.sourceTabId === AUTO_REFRESH_TAB_ID) {
    return;
  }

  if (!rememberExternalEvent(normalizedPayload.id)) {
    return;
  }

  dispatchLocalAutoRefresh(normalizedPayload, { dispatchLegacy: true });
}

export function ensureAutoRefreshBridge() {
  if (bridgeStarted || typeof window === "undefined") {
    return;
  }

  bridgeStarted = true;

  const channel = getBroadcastChannel();
  if (channel) {
    channel.addEventListener("message", (event) => {
      handleExternalAutoRefresh(event.data);
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== AUTO_REFRESH_STORAGE_KEY || !event.newValue) {
      return;
    }

    handleExternalAutoRefresh(event.newValue);
  });
}

/**
 * `broadcast: false` keeps an event inside this tab, for callers whose trigger every tab already
 * sees for itself — relaying those would make one change bounce around the browser and trigger a
 * second round of reloads for no new information.
 */
export function publishAutoRefresh(payload = {}) {
  const normalizedPayload = createAutoRefreshPayload(payload);

  if (typeof window === "undefined") {
    return normalizedPayload;
  }

  dispatchLocalAutoRefresh(normalizedPayload, {
    dispatchLegacy: payload.dispatchLegacy !== false,
  });

  if (payload.broadcast === false) {
    return normalizedPayload;
  }

  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage(normalizedPayload);
    } catch {
      // BroadcastChannel is a best-effort transport.
    }
  }

  try {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(normalizedPayload));
  } catch {
    // localStorage may be unavailable in private or restricted browser modes.
  }

  return normalizedPayload;
}

export function subscribeAutoRefresh(listener, options = {}) {
  if (typeof window === "undefined" || typeof listener !== "function") {
    return () => {};
  }

  ensureAutoRefreshBridge();

  const watchedTopics = normalizeAutoRefreshTopics(options.topics || options.topic || AUTO_REFRESH_ALL_TOPIC);
  const handleEvent = (event) => {
    const payload = normalizeAutoRefreshPayload(event.detail);

    if (!payload || !autoRefreshTopicMatches(payload.topics || payload.topic, watchedTopics)) {
      return;
    }

    listener(payload);
  };

  window.addEventListener(AUTO_REFRESH_EVENT, handleEvent);

  return () => {
    window.removeEventListener(AUTO_REFRESH_EVENT, handleEvent);
  };
}

/**
 * Whether the long-poll change feed is currently delivering for this browser.
 *
 * Owned by `liveUpdatesService`; read by `useAutoRefreshOnChange` to decide how hard its own timer
 * has to work. It lives here rather than in the service so that the hook never imports the service —
 * a screen must keep refreshing on its timer whether or not the feed was ever started.
 */
export function setLiveUpdatesHealthy(next) {
  const value = Boolean(next);

  if (value === liveUpdatesHealthy) {
    return value;
  }

  liveUpdatesHealthy = value;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LIVE_UPDATES_HEALTH_EVENT, { detail: { healthy: value } }));
  }

  return value;
}

export function isLiveUpdatesHealthy() {
  return liveUpdatesHealthy;
}

ensureAutoRefreshBridge();

const autoRefreshConfig = {
  AUTO_REFRESH_ALL_TOPIC,
  AUTO_REFRESH_CHANNEL_NAME,
  AUTO_REFRESH_DEBOUNCE_MS,
  AUTO_REFRESH_EVENT,
  AUTO_REFRESH_FALLBACK_INTERVAL_MS,
  AUTO_REFRESH_LIVE_INTERVAL_MS,
  AUTO_REFRESH_STORAGE_KEY,
  AUTO_REFRESH_TAB_ID,
  LIVE_UPDATES_HEALTH_EVENT,
  createAutoRefreshPayload,
  ensureAutoRefreshBridge,
  isLiveUpdatesHealthy,
  normalizeAutoRefreshPayload,
  normalizeAutoRefreshTopic,
  normalizeAutoRefreshTopics,
  publishAutoRefresh,
  setLiveUpdatesHealthy,
  shouldPublishAutoRefreshForRequest,
  subscribeAutoRefresh,
  topicFromRequestUrl,
};

export default autoRefreshConfig;
