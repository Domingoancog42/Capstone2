import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye } from "@fortawesome/free-solid-svg-icons";
import ActionsMenu from "./ActionsMenu";

/**
 * A request row's actions: "View Form" stays out in the row, and every other action goes into the
 * dots menu beside it. Children are the menu's buttons; null ones are dropped, and the dots are left
 * out entirely when nothing remains, so the menu never opens empty.
 *
 * The button is deliberately plain — white, a gray border and dark text rather than one of the
 * colored action tones — and matches the dots trigger's height so the pair lines up.
 */
export default function ViewFormActions({ viewLabel = "View form", onView, children }) {
  const menuActions = React.Children.toArray(children);

  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <button
        type="button"
        aria-label={viewLabel}
        title={viewLabel}
        onClick={onView}
        className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
      >
        <FontAwesomeIcon icon={faEye} className="text-[12px]" aria-hidden="true" />
        <span>View Form</span>
      </button>
      {menuActions.length ? <ActionsMenu>{menuActions}</ActionsMenu> : null}
    </div>
  );
}
