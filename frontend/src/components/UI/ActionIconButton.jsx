import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const toneClasses = {
  view: "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100 focus:ring-sky-100",
  review: "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 focus:ring-indigo-100",
  edit: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 focus:ring-amber-100",
  approve: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 focus:ring-emerald-100",
  reject: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 focus:ring-rose-100",
  cancel: "border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200 focus:ring-slate-100",
  archive: "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 focus:ring-rose-100",
  print: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100 focus:ring-violet-100",
  delete: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100 focus:ring-red-100",
};

export default function ActionIconButton({ label, icon, tone = "view", className = "", ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tone={tone}
      className={`action-icon-button inline-flex h-8 w-8 items-center justify-center rounded-lg border transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${toneClasses[tone] || toneClasses.view} ${className}`.trim()}
      {...props}
    >
      <FontAwesomeIcon icon={icon} className="text-[14px]" aria-hidden="true" />
    </button>
  );
}

