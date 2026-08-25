import React from "react";
import { ShieldAlert } from "lucide-react";
import { isSecurityNotificationType } from "../../services/notificationService";

/*
 * Every notification type wears the same pale red pill, which is fine while the pill is only saying
 * which module a message came from. A security alert is not that: it reports on somebody else's
 * account and wants acting on, so it takes solid red and a shield to separate it at a glance from
 * the leave requests and payroll runs it sits between.
 *
 * Shared by the bell and the notifications centre so the two cannot drift apart on which types are
 * treated as security alerts or on what one looks like.
 */
export default function NotificationTypeChip({ type, label, compact = false }) {
  const sizeClass = compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  if (isSecurityNotificationType(type)) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[#B0161B] font-semibold text-white ${sizeClass}`}
      >
        <ShieldAlert size={compact ? 12 : 13} aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full bg-[#D61E1E]/10 font-semibold text-[#D61E1E] ${sizeClass}`}
    >
      {label}
    </span>
  );
}
