import React from "react";
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

/**
 * Contact-list timestamps: a clock time for today, a date for anything older. A conversation list is
 * scanned for "when did we last speak", which today's time answers and today's date does not.
 */
export function formatContactTime(value) {
  const date = new Date(String(value || "").replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  if (sameDay) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function formatMessageTime(value) {
  const date = new Date(String(value || "").replace(" ", "T"));

  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
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
