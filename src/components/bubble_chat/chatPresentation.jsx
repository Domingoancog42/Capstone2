import React, { useSyncExternalStore } from "react";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

/*
 * How a contact and a timestamp are drawn, shared by the two surfaces that show a conversation:
 * the full Communications workspace (bubble_chat.jsx) and the header popover
 * (ChatBubbleButton.jsx). They render the same rows from the same endpoint, so keeping one copy is
 * what stops an avatar or a timestamp format meaning one thing in the page and another in the
 * popover.
 */

export function initialsFor(name = "") {
  return String(name || "User")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";
}

const ONLINE_PRESENCE_VALUES = new Set(["online", "1", "true", "yes"]);

export function isContactOnline(contact) {
  const explicitFlag = contact?.isOnline ?? contact?.online ?? contact?.is_online;

  if (typeof explicitFlag === "boolean") {
    return explicitFlag;
  }

  if (typeof explicitFlag === "number") {
    return explicitFlag > 0;
  }

  const explicitStatus = contact?.presenceStatus ?? contact?.presence ?? contact?.onlineStatus;

  return ONLINE_PRESENCE_VALUES.has(String(explicitStatus || "").trim().toLowerCase());
}

function parseChatTimestamp(value) {
  const date = new Date(String(value || "").replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When a message was sent, the way a messenger says it: "Just now", then minutes and hours ago for
 * today, "Yesterday", and the date itself before that -- with the year once it is not this year's.
 * Used for the message bubbles and the contact list alike, so both read the same.
 *
 * A timestamp a few seconds ahead of this machine's clock (server and browser rarely agree to the
 * second) reads as "Just now" rather than a negative age.
 */
export function formatChatTime(value, now = Date.now()) {
  const date = parseChatTimestamp(value);

  if (!date) {
    return "";
  }

  const current = new Date(now);
  const elapsedMinutes = Math.floor((current.getTime() - date.getTime()) / 60000);

  if (elapsedMinutes < 1) {
    return "Just now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} ${elapsedMinutes === 1 ? "min" : "mins"} ago`;
  }

  if (date.toDateString() === current.toDateString()) {
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return `${elapsedHours} ${elapsedHours === 1 ? "hr" : "hrs"} ago`;
  }

  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== current.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

/** The exact send time, for the hover title behind a relative label. */
export function formatFullChatTime(value) {
  const date = parseChatTimestamp(value);

  return date
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date)
    : "";
}

/*
 * One shared clock for every timestamp on screen, so "Just now" turns into "1 min ago" while the chat
 * sits open. A single interval runs only while at least one timestamp is mounted.
 */
const CHAT_CLOCK_INTERVAL_MS = 30000;
const chatClockListeners = new Set();
let chatClockNow = Date.now();
let chatClockTimer = null;

function subscribeChatClock(listener) {
  chatClockListeners.add(listener);

  if (!chatClockTimer) {
    chatClockNow = Date.now();
    chatClockTimer = window.setInterval(() => {
      chatClockNow = Date.now();
      chatClockListeners.forEach((notify) => notify());
    }, CHAT_CLOCK_INTERVAL_MS);
  }

  return () => {
    chatClockListeners.delete(listener);

    if (chatClockListeners.size === 0 && chatClockTimer) {
      window.clearInterval(chatClockTimer);
      chatClockTimer = null;
    }
  };
}

function readChatClock() {
  return chatClockNow;
}

export function ChatTimestamp({ value }) {
  /*
   * Subscribing is what re-renders the label on each tick. The age itself is measured against the
   * moment of rendering, so a message sent between two ticks still reads "Just now" straight away.
   */
  useSyncExternalStore(subscribeChatClock, readChatClock);
  const label = formatChatTime(value, Date.now());

  if (!label) {
    return null;
  }

  return (
    <time dateTime={String(value || "").replace(" ", "T")} title={formatFullChatTime(value)}>
      {label}
    </time>
  );
}

/*
 * The presence dot is opt-in so message rows can show online/offline without forcing that marker
 * onto every place an avatar is used.
 */
export function Avatar({ contact, size = "md", showPresence = false }) {
  const imageUrl = resolveBackendAssetUrl(contact?.profileImage);
  const sizeClass =
    size === "lg"
      ? "h-12 w-12 text-base"
      : size === "sm"
        ? "h-9 w-9 text-xs"
        : "h-10 w-10 text-sm";
  const dotSizeClass = size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3";
  const name = contact?.name || contact?.username || "User";
  const online = isContactOnline(contact);
  const presenceLabel = online ? "Online" : "Offline";

  return (
    <div className="relative shrink-0" title={showPresence ? `${name} is ${presenceLabel.toLowerCase()}` : undefined}>
      <div className={`${sizeClass} grid place-items-center overflow-hidden rounded-full border border-slate-100 bg-gradient-to-br from-slate-100 to-slate-200 font-semibold text-slate-600 shadow-sm`}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{initialsFor(name)}</span>
        )}
      </div>
      {showPresence ? (
        <span
          role="img"
          aria-label={`${name} is ${presenceLabel.toLowerCase()}`}
          className={`absolute bottom-0 right-0 rounded-full border-2 border-white shadow-sm ${
            online ? "bg-emerald-500" : "bg-slate-300"
          } ${dotSizeClass}`}
        />
      ) : null}
    </div>
  );
}
