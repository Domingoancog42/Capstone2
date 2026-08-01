import React from "react";
import { FilePenLine } from "lucide-react";

export default function LeaveRequest({ onOpenRequestModal, disabled = false }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-900">Leave Request</h3>
          <p className="m-0 mt-1 text-sm text-slate-500">
            File a new leave request and attach supporting documents.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenRequestModal}
          disabled={disabled}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FilePenLine size={16} />
          Open Request Form
        </button>
      </div>
    </section>
  );
}
