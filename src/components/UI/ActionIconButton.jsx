import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

// Tone colors live in tailwind.css keyed on `data-tone` so light and dark themes
// share one solid palette instead of two sets of utility classes.

// Default word shown next to the icon when a caller doesn't pass `text` — keyed on
// `tone` since tone already encodes what the action does everywhere this is used.
const toneWords = {
  view: "View",
  review: "Review",
  edit: "Edit",
  approve: "Approve",
  reject: "Reject",
  cancel: "Cancel",
  archive: "Archive",
  restore: "Restore",
  print: "Print",
  export: "Export",
  delete: "Delete",
};

export default function ActionIconButton({ label, icon, tone = "view", text, className = "", ...props }) {
  const word = text || toneWords[tone] || label;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tone={tone}
      className={`action-icon-button inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`.trim()}
      {...props}
    >
      <FontAwesomeIcon icon={icon} className="text-[12px]" aria-hidden="true" />
      <span>{word}</span>
    </button>
  );
}

