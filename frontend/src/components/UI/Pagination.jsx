import React from "react";

const buttonClasses = "inline-flex min-h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  disabled = false,
  className = "",
}) {
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const safeCurrentPage = Math.min(Math.max(1, Number(currentPage) || 1), safeTotalPages);

  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`.trim()}>
      <button
        type="button"
        className={buttonClasses}
        disabled={disabled || safeCurrentPage <= 1}
        onClick={() => onPageChange?.(Math.max(1, safeCurrentPage - 1))}
      >
        Previous
      </button>

      <span className="text-xs font-semibold text-slate-700">
        Page {safeCurrentPage} of {safeTotalPages}
      </span>

      <button
        type="button"
        className={buttonClasses}
        disabled={disabled || safeCurrentPage >= safeTotalPages}
        onClick={() => onPageChange?.(Math.min(safeTotalPages, safeCurrentPage + 1))}
      >
        Next
      </button>
    </div>
  );
}
