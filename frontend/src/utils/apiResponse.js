/**
 * Helpers for reading axios error/success payloads coming back from backend/api/*.php,
 * which all answer with `{ success, message, ... }`.
 */

/** Pulls the server's message off an axios error, falling back to a caller-supplied string. */
export function getResponseMessage(error, fallback = "Something went wrong. Please try again.") {
  return error?.response?.data?.message || error?.message || fallback;
}

/** HTTP status of a failed request, or 0 when the request never reached the server. */
export function getResponseStatus(error) {
  return Number(error?.response?.status) || 0;
}

/** Seconds the caller must wait, as reported by the throttled OTP endpoints (HTTP 429). */
export function getRetryAfterSeconds(error) {
  const data = error?.response?.data || {};
  return Math.max(0, Number(data.resendAvailableInSeconds ?? data.lockedForSeconds ?? 0) || 0);
}
