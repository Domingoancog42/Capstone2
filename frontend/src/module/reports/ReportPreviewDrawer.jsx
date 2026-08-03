import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSpreadsheet, FileText, Printer, X } from "lucide-react";
import { formatCompact, formatNumber, useReportsTheme } from "./reportsTheme";
import { statusBadgeClasses } from "./ReportsDataTable";

const PREVIEW_ROW_LIMIT = 200;

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
}) {
  const theme = useReportsTheme();

  useEffect(() => {
    if (!open) {
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
  }, [onClose, open]);

  const distribution = useMemo(() => {
    const raw = report?.summary?.distribution || [];
    const total = raw.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

    return raw.map((item) => ({
      label: item.label || "Unspecified",
      value: Number(item.value) || 0,
      percentage: total > 0 ? ((Number(item.value) || 0) / total) * 100 : 0,
    }));
  }, [report]);

  const columns = report?.columns || [];
  const rows = report?.rows || [];
  const previewRows = rows.slice(0, PREVIEW_ROW_LIMIT);

  if (typeof document === "undefined") {
    return null;
  }

  // Portalled to <body> so the drawer escapes the dashboard's stacking context
  // and so printing can hide #root wholesale.
  return createPortal(
    <AnimatePresence>
      {open && report ? (
        <div
          className="reports-dashboard reports-print-shell fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={`${report.label} preview`}
        >
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

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.24, ease: "easeOut" }}
            className="reports-print-panel relative z-10 flex h-full w-full flex-col bg-white shadow-2xl xl:w-[min(1180px,92vw)]"
          >
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

            <div className="reports-print-area flex-1 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-4">
              <article className="mx-auto max-w-5xl space-y-5">
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h1 className="m-0 text-xl font-semibold text-slate-900">{report.label}</h1>
                      <p className="m-0 mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">{report.description}</p>
                    </div>
                    <dl className="m-0 shrink-0 space-y-1 text-xs sm:text-right">
                      <div className="flex gap-2 sm:justify-end">
                        <dt className="m-0 font-semibold text-slate-500">Generated</dt>
                        <dd className="m-0 text-slate-800">{new Date().toLocaleString()}</dd>
                      </div>
                      {generatedBy ? (
                        <div className="flex gap-2 sm:justify-end">
                          <dt className="m-0 font-semibold text-slate-500">By</dt>
                          <dd className="m-0 text-slate-800">{generatedBy}</dd>
                        </div>
                      ) : null}
                      {dateRange ? (
                        <div className="flex gap-2 sm:justify-end">
                          <dt className="m-0 font-semibold text-slate-500">Period</dt>
                          <dd className="m-0 text-slate-800">{`${dateRange.start} to ${dateRange.end}`}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

                {distribution.length > 0 ? (
                  <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <h2 className="m-0 text-sm font-semibold text-slate-900">Distribution</h2>
                    <p className="m-0 mt-1 text-xs text-slate-500">Breakdown of the records included in this report.</p>

                    <div className="mt-4">
                      <ResponsiveContainer width="100%" height={Math.max(220, distribution.length * 34 + 30)}>
                        <BarChart data={distribution} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                          <CartesianGrid stroke={theme.grid} horizontal={false} />
                          <XAxis
                            type="number"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: theme.textMuted, fontSize: 11 }}
                            tickFormatter={formatCompact}
                          />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={150}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: theme.textMuted, fontSize: 11 }}
                          />
                          <Tooltip
                            cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
                            formatter={(value, name, item) => [
                              `${formatNumber(value)} (${(item?.payload?.percentage || 0).toFixed(1)}%)`,
                              "Records",
                            ]}
                            contentStyle={{
                              backgroundColor: theme.surface,
                              borderColor: theme.grid,
                              borderRadius: 8,
                              color: theme.text,
                              fontSize: 12,
                            }}
                          />
                          <Bar dataKey="value" name="Records" radius={[0, 4, 4, 0]} maxBarSize={22}>
                            {distribution.map((entry) => (
                              <Cell key={entry.label} fill={theme.series[0]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                ) : null}

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
                              className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-600"
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
                                  <td key={column.key} className="border-b border-slate-100 px-4 py-2.5 text-sm text-slate-700">
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
