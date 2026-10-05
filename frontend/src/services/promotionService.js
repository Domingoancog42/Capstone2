import api from "./api";
import { notifyNotificationsChanged } from "./notificationService";

export const PROMOTIONS_CHANGED_EVENT = "promotions:changed";

export function notifyPromotionsChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(PROMOTIONS_CHANGED_EVENT));
}

export async function fetchPromotions({ archived = false } = {}) {
  const response = await api.get("/promotion.php", {
    params: archived ? { archived: 1 } : {},
  });
  return response.data;
}

export async function fetchPromotionById(promotionId) {
  const response = await api.get("/promotion.php", { params: { id: promotionId } });
  return response.data;
}

/** The designation catalog (with hierarchy levels) and the active employees the form picks from. */
export async function fetchPromotionOptions() {
  const response = await api.get("/promotion.php", { params: { resource: "options" } });
  return response.data;
}

/**
 * The signed-in employee's approved promotions they have not yet been congratulated for. Empty for
 * a session with no employee record, and again once each one has been acknowledged.
 */
export async function fetchPromotionGreetings() {
  const response = await api.get("/promotion.php", { params: { resource: "greetings" } });
  return response.data;
}

/** Stamps the promotion as greeted so the dashboard congratulations do not show a second time. */
export async function acknowledgePromotionGreeting(promotionId) {
  const response = await api.put("/promotion.php", { id: promotionId, action: "acknowledge" });
  return response.data;
}

/** Marks the signed-in employee's approved promotions as seen from their My Promotion page. */
export async function markPromotionsViewed() {
  const response = await api.put("/promotion.php", { action: "mark_viewed" });
  notifyPromotionsChanged();
  return response.data;
}

export async function preparePromotion(payload) {
  const response = await api.post("/promotion.php", payload);
  notifyPromotionsChanged();
  notifyNotificationsChanged();
  return response.data;
}

/**
 * `action` is one of recommend | approve | reject | cancel. Recommending and approving carry a
 * solved captcha (`{ captchaId, captchaAnswer }` from requestApprovalCaptcha()); promotion.php
 * refuses them without one. Rejecting needs a note and passes no captcha.
 */
export async function updatePromotionStatus(promotionId, action, note = "", captcha = {}) {
  const response = await api.put("/promotion.php", {
    id: promotionId,
    action,
    rejectedNote: String(note || "").trim(),
    ...captcha,
  });
  notifyPromotionsChanged();
  notifyNotificationsChanged();
  return response.data;
}

export async function archivePromotion(promotionId) {
  const response = await api.put("/promotion.php", { id: promotionId, action: "archive" });
  notifyPromotionsChanged();
  return response.data;
}

export async function restorePromotion(promotionId) {
  const response = await api.put("/promotion.php", { id: promotionId, action: "restore" });
  notifyPromotionsChanged();
  return response.data;
}
