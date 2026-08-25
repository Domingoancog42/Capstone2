import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FileSpreadsheet, FileText, Printer, X } from "lucide-react";
import { formatNumber } from "./reportsTheme";
import { statusBadgeClasses } from "./ReportsDataTable";

const PREVIEW_ROW_LIMIT = 200;

/*
 * The letterhead every other printed form in the system carries — the DTR, the pass slip, the travel
 * order — so a printed report is recognisably from the same office as the rest of the paperwork. The
 * seal lives in `public/`, which means it survives the print dialog without needing to be inlined.
 */
const ORGANIZATION_NAME = "Mines and Geosciences Bureau - 10";
const ORGANIZATION_SUBTITLE = "DENR Region X, Macabalan, Cagayan de Oro City";
const ORGANIZATION_LOGO = "/mgb.png";

/**
 * Centred masthead: seal, office, then the report's own title.
 *
 * The seal is positioned rather than laid out in the flow so that the office name is centred on the
 * page itself, not on the space beside the logo — the same trick the DTR header uses, and the reason
 * a report printed next to a DTR lines up with it.
 */
function ReportLetterhead({ title, description }) {
  return (
    <header className="relative mb-4 border-b border-slate-300 pb-4 text-center">
      <img
        src={ORGANIZATION_LOGO}
        alt=""
        aria-hidden="true"
        className="absolute left-0 top-0 h-16 w-16 rounded-full border border-slate-200 object-contain"
      />
      <p className="m-0 text-base font-bold uppercase tracking-wide text-slate-900">{ORGANIZATION_NAME}</p>
      <p className="m-0 mt-0.5 text-xs text-slate-600">{ORGANIZATION_SUBTITLE}</p>
      <h1 className="m-0 mt-3 text-lg font-semibold uppercase tracking-wide text-slate-900">{title}</h1>
      {description ? (
        <p className="m-0 mx-auto mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
      ) : null}
    </header>
  );
}

export default function ReportPreviewDrawer({
  open,
  report,
  dateRange,
  filterChips = [],
  generatedBy,
  onClose,
  onPrint,
  onExport,
  exporting = false,
  printOnly = false,
}) {
  useEffect(() => {
    if (!open || printOnly) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, printOnly]);

  const columns = report?.columns || [];
  const rows = report?.rows || [];
  const previewRows = rows.slice(0, PREVIEW_ROW_LIMIT);
  /*
   * Status stays on screen and comes off the printed sheet, matching what the PDF, Excel and CSV
   * writers do (see reports_export_columns() in reports.php). The report is filtered to a status
   * before it is printed — "Approved Leave", "Active Employees" — so the column repeats the same
   * word down the page and costs width the other columns need.
   *
   * An aggregate keeps it: Net Pay Summary groups BY status, so there the column is what names each
   * row rather than a repeat of the filter.
   *
   * Only the exact `status` key goes. `employmentStatus` and `approvalStatus` are different facts
   * that happen to share the word.
   */
  const hideStatusOnPrint = !report?.isAggregate;

  if (typeof document === "undefined") {
    return null;
  }

  /*
   * `printOnly` is the toolbar's Print button: the document still has to be in the DOM for the
   * browser to print it, but the drawer must not slide in on screen first. The shell is parked
   * off-canvas instead of hidden — `display: none` would print nothing — and the print stylesheet
   * puts it back in the flow. No backdrop, no scroll lock, no slide-in either: nothing here is on
   * screen to animate.
   */
  const panelMotion = printOnly
    ? {}
    : {
        initial: { x: "100%" },
        animate: { x: 0 },
        exit: { x: "100%" },
        transition: { type: "tween", duration: 0.24, ease: "easeOut" },
      };

  // Portalled to <body> so the drawer escapes the dashboard's stacking context
  // and so printing can hide #root wholesale.
  return createPortal(
    <AnimatePresence>
      {open && report ? (
        <div
          className={`reports-dashboard reports-print-shell ${
            printOnly ? "reports-print-only" : "fixed inset-0 z-50 flex justify-end"
          }`}
          role={printOnly ? undefined : "dialog"}
          aria-modal={printOnly ? undefined : "true"}
          aria-hidden={printOnly ? "true" : undefined}
          aria-label={printOnly ? undefined : `${report.label} preview`}
        >
          {printOnly ? null : (
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onClose}
              aria-label="Close preview"
              className="reports-no-print absolute inset-0 border-0 bg-slate-900/50 dark:bg-slate-950/80"
            />
          )}

          <motion.div
            {...panelMotion}
            className="reports-print-panel relative z-10 flex h-full w-full flex-col bg-white shadow-2xl xl:w-[min(1180px,92vw)]"
          >
            {printOnly ? null : (
              <header className="reports-no-print flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-4">
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {report.categoryLabel || "Report"}
                  </p>
                  <h2 className="m-0 truncate text-lg font-semibold text-slate-900">{report.label}</h2>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={onPrint}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Printer size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">Print</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onExport?.("pdf")}
                    disabled={exporting}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onExport?.("xlsx")}
                    disabled={exporting}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FileSpreadsheet size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close preview"
                    className="grid h-[38px] w-[38px] place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </header>
            )}

            <div className="reports-print-area flex-1 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-4">
              <article className="mx-auto max-w-5xl space-y-5">
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                  <ReportLetterhead title={report.label} description={report.description} />

                  <dl className="m-0 flex flex-wrap justify-center gap-x-6 gap-y-1 border-b border-slate-200 pb-4 text-xs">
                    <div className="flex gap-2">
                      <dt className="m-0 font-semibold text-slate-500">Generated</dt>
                      <dd className="m-0 text-slate-800">{new Date().toLocaleString()}</dd>
                    </div>
                    {generatedBy ? (
                      <div className="flex gap-2">
                        <dt className="m-0 font-semibold text-slate-500">By</dt>
                        <dd className="m-0 text-slate-800">{generatedBy}</dd>
                      </div>
                    ) : null}
                    {dateRange ? (
                      <div className="flex gap-2">
                        <dt className="m-0 font-semibold text-slate-500">Period</dt>
                        <dd className="m-0 text-slate-800">{`${dateRange.start} to ${dateRange.end}`}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {/* Screen-only. A printed report is a formal document: these tiles are dashboard
                      furniture, so they stay off paper and the sheet carries the letterhead, the
                      run details and the records. */}
                  <div className="reports-print-hide mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
                      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Records</p>
                      <p className="m-0 mt-1 text-xl font-semibold text-slate-900">{formatNumber(rows.length)}</p>
                    </div>
                    {(report.summary?.keyStatistics || []).slice(0, 3).map((statistic) => (
                      <div key={statistic.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
                        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{statistic.label}</p>
                        <p className="m-0 mt-1 text-xl font-semibold text-slate-900">{statistic.value}</p>
                      </div>
                    ))}
                  </div>

                  {filterChips.length > 0 ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Filters</span>
                      {filterChips.map((chip) => (
                        <span
                          key={chip.key}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                        >
                          <span className="text-slate-500">{chip.label}:</span>
                          {chip.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
                    <h2 className="m-0 text-sm font-semibold text-slate-900">Report Data</h2>
                    {rows.length > PREVIEW_ROW_LIMIT ? (
                      <p className="m-0 text-xs text-slate-500">
                        {`Previewing the first ${PREVIEW_ROW_LIMIT} of ${formatNumber(rows.length)} records — exports include all rows.`}
                      </p>
                    ) : null}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse">
                      <thead>
                        <tr>
                          {columns.map((column) => (
                            <th
                              key={column.key}
                              className={`border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-600 ${
                                hideStatusOnPrint && column.key === "status" ? "reports-print-hide" : ""
                              }`}
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.length === 0 ? (
                          <tr>
                            <td colSpan={Math.max(columns.length, 1)} className="px-4 py-10 text-center text-sm text-slate-500">
                              No records found for the selected filters.
                            </td>
                          </tr>
                        ) : (
                          previewRows.map((row, index) => (
                            <tr key={row.id ?? `preview-${index}`} className="transition hover:bg-slate-50">
                              {columns.map((column) => {
                                const value = row[column.key] ?? "N/A";
                                const isStatus = /status/i.test(column.key);

                                return (
                                  <td
                                    key={column.key}
                                    className={`border-b border-slate-100 px-4 py-2.5 text-sm text-slate-700 ${
                                      hideStatusOnPrint && column.key === "status" ? "reports-print-hide" : ""
                                    }`}
                                  >
                                    {isStatus ? (
                                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClasses(value)}`}>
                                        {value}
                                      </span>
                                    ) : (
                                      value
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <p className="m-0 pb-2 text-center text-[11px] text-slate-400">
                  {`Generated from the HRIS Reports module on ${new Date().toLocaleString()}.`}
                </p>
              </article>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
