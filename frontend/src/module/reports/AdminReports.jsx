import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import {
  Check,
  ChevronDown,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderTree,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Sheet,
} from "lucide-react";
import {
  exportReportData,
  getReportCatalog,
  getReportData,
  getReportFilterOptions,
  getReportsDashboard,
  logReportAction,
} from "../../services/api";
import ReportsCharts from "./ReportsCharts";
import ReportsDataTable from "./ReportsDataTable";
import ReportPreviewDrawer from "./ReportPreviewDrawer";
import { REPORT_CATEGORIES } from "./reportCategories";
import { DATE_RANGE_OPTIONS, downloadBlob, localDateString } from "./reportsTheme";

const EMPTY_ARRAY = [];

/** Filter controls, keyed by the backend filter name they map onto. */
const FILTER_CONTROLS = [
  { key: "divisionId", label: "Division", optionsKey: "divisions", placeholder: "All Divisions" },
  { key: "designationId", label: "Designation", optionsKey: "designations", placeholder: "All Designations" },
  { key: "employmentStatus", label: "Employment Status", optionsKey: "employmentStatuses", placeholder: "All Statuses" },
  { key: "gender", label: "Gender", optionsKey: "genders", placeholder: "All Genders" },
  { key: "status", label: "Record Status", optionsKey: "statuses", placeholder: "All" },
  { key: "leaveTypeId", label: "Leave Type", optionsKey: "leaveTypes", placeholder: "All Leave Types" },
  { key: "payrollYear", label: "Payroll Year", optionsKey: "payrollYears", placeholder: "All Years" },
  { key: "payrollMonth", label: "Payroll Month", optionsKey: "payrollMonths", placeholder: "All Months" },
];

const selectClasses =
  "min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400";

/** Command-style searchable picker over the full report catalog. */
function ReportPicker({ catalog, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selected = useMemo(() => {
    for (const category of catalog) {
      const found = category.reports.find((report) => report.key === value);

      if (found) {
        return found;
      }
    }

    return null;
  }, [catalog, value]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    return catalog
      .map((category) => ({
        ...category,
        reports: category.reports.filter(
          (report) =>
            term === ""
            || report.label.toLowerCase().includes(term)
            || report.description.toLowerCase().includes(term)
        ),
      }))
      .filter((category) => category.reports.length > 0);
  }, [catalog, query]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-900 transition hover:border-slate-300"
      >
        <span className="truncate font-medium">{selected?.label || "Select a report"}</span>
        <ChevronDown size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-[320px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-200">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reports..."
              aria-label="Search reports"
              className="min-h-[42px] w-full border-0 bg-transparent pl-9 pr-3 text-sm text-slate-900 outline-none"
            />
          </div>

          <div className="max-h-[340px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="m-0 px-3 py-4 text-center text-sm text-slate-500">No reports match that search.</p>
            ) : (
              filtered.map((category) => (
                <div key={category.key}>
                  <p className="m-0 px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {category.label}
                  </p>
                  {category.reports.map((report) => (
                    <button
                      key={report.key}
                      type="button"
                      disabled={!report.available}
                      onClick={() => {
                        onChange(report.key);
                        setOpen(false);
                      }}
                      className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{report.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {report.available ? report.description : "Not available — required tables are missing."}
                        </span>
                      </span>
                      {report.key === value ? (
                        <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarButton({ icon: Icon, children, onClick, disabled, busy, variant = "secondary" }) {
  const tone =
    variant === "primary"
      ? "border-[#D61E1E] bg-[#D61E1E] text-white hover:bg-[#B41818] dark:border-[#21c45d] dark:bg-[#21c45d]"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
      <span className="hidden sm:inline">{children}</span>
    </button>
  );
}

export default function AdminReports({ showSummary = true, user, category = "" }) {
  const today = useMemo(() => localDateString(), []);

  const [filters, setFilters] = useState({
    dateRange: "last30",
    customStart: today,
    customEnd: today,
    reportType: "employee-list",
    divisionId: "",
    designationId: "",
    employmentStatus: "",
    gender: "",
    status: "",
    leaveTypeId: "",
    payrollYear: "",
    payrollMonth: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [catalog, setCatalog] = useState(EMPTY_ARRAY);
  const [filterOptions, setFilterOptions] = useState({});
  const [dashboard, setDashboard] = useState(null);
  const [report, setReport] = useState(null);

  const [dashboardLoading, setDashboardLoading] = useState(showSummary);
  const [reportLoading, setReportLoading] = useState(true);
  const [hasLoadedReport, setHasLoadedReport] = useState(false);
  const [exporting, setExporting] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState("");

  /* ---------------- Static lookups ---------------- */

  useEffect(() => {
    let active = true;

    Promise.all([getReportCatalog(), getReportFilterOptions()])
      .then(([catalogPayload, filtersPayload]) => {
        if (!active) {
          return;
        }

        setCatalog(catalogPayload.categories || EMPTY_ARRAY);
        setFilterOptions(filtersPayload.filters || {});
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.message || "Unable to load the report catalog.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  /* ---------------- Debounced global search ---------------- */

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /* ---------------- Request parameters ---------------- */

  const dateParams = useMemo(
    () => ({
      dateRange: filters.dateRange,
      ...(filters.dateRange === "custom"
        ? { customStart: filters.customStart, customEnd: filters.customEnd }
        : {}),
    }),
    [filters.customEnd, filters.customStart, filters.dateRange]
  );

  const supportedFilters = report?.supportedFilters || EMPTY_ARRAY;

  /* ---------------- Category scoping ---------------- */

  const activeCategory = useMemo(
    () => catalog.find((entry) => entry.key === category) || null,
    [catalog, category]
  );
  /** The picker only ever sees the selected category, so a report outside it cannot be chosen. */
  const categoryCatalog = useMemo(
    () => (activeCategory ? [activeCategory] : EMPTY_ARRAY),
    [activeCategory]
  );
  const reportTypeInCategory = useMemo(
    () => (activeCategory?.reports || EMPTY_ARRAY).some((entry) => entry.key === filters.reportType),
    [activeCategory, filters.reportType]
  );
  const categoryTitle =
    activeCategory?.label
    || REPORT_CATEGORIES.find((entry) => entry.key === category)?.title
    || "Reports";

  /**
   * `reportType` carries over when the category changes, so snap it to the first available report
   * of the new category before anything tries to fetch it.
   */
  useEffect(() => {
    if (!activeCategory || reportTypeInCategory) {
      return;
    }

    const reports = activeCategory.reports || EMPTY_ARRAY;
    const nextReport = reports.find((entry) => entry.available) || reports[0];

    if (nextReport) {
      setFilters((current) => ({ ...current, reportType: nextReport.key }));
    }
  }, [activeCategory, reportTypeInCategory]);

  /** Nothing is fetched until a category is picked and its report is the one selected. */
  const canLoadReport = Boolean(category) && reportTypeInCategory;

  const reportParams = useMemo(() => {
    const params = {
      ...dateParams,
      reportType: filters.reportType,
      search,
    };

    FILTER_CONTROLS.forEach((control) => {
      const value = filters[control.key];

      if (value) {
        params[control.key] = value;
      }
    });

    return params;
  }, [dateParams, filters, search]);

  const customRangeIncomplete =
    filters.dateRange === "custom" && (!filters.customStart || !filters.customEnd);

  /* ---------------- Dashboard ---------------- */

  const loadDashboard = useCallback(() => {
    if (!showSummary || !category || customRangeIncomplete) {
      return undefined;
    }

    let active = true;
    setDashboardLoading(true);

    getReportsDashboard({
      ...dateParams,
      ...(filters.divisionId ? { divisionId: filters.divisionId } : {}),
    })
      .then((payload) => {
        if (active) {
          setDashboard(payload.dashboard || null);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.message || "Unable to load dashboard analytics.");
        }
      })
      .finally(() => {
        if (active) {
          setDashboardLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [category, customRangeIncomplete, dateParams, filters.divisionId, showSummary]);

  useEffect(() => loadDashboard(), [loadDashboard]);

  /* ---------------- Report data ---------------- */

  useEffect(() => {
    if (!canLoadReport) {
      return undefined;
    }

    if (customRangeIncomplete) {
      setError("Please select both a start and end date for the custom range.");
      return undefined;
    }

    let active = true;
    setReportLoading(true);
    setError("");

    getReportData(reportParams)
      .then((payload) => {
        if (!active) {
          return;
        }

        setReport(payload.report || null);
        setHasLoadedReport(true);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }

        setError(requestError.response?.data?.message || "Unable to generate the selected report.");
        setReport(null);
      })
      .finally(() => {
        if (active) {
          setReportLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [canLoadReport, customRangeIncomplete, reportParams]);

  /* ---------------- Actions ---------------- */

  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const activeFilterChips = useMemo(() => {
    const chips = [];

    FILTER_CONTROLS.forEach((control) => {
      const value = filters[control.key];

      if (!value || !supportedFilters.includes(control.key)) {
        return;
      }

      const option = (filterOptions[control.optionsKey] || EMPTY_ARRAY).find((item) => item.value === value);
      chips.push({ key: control.key, label: control.label, value: option?.label || value });
    });

    if (search) {
      chips.push({ key: "search", label: "Search", value: search });
    }

    return chips;
  }, [filterOptions, filters, search, supportedFilters]);

  const clearChip = (key) => {
    if (key === "search") {
      setSearchInput("");
      return;
    }

    updateFilter(key, "");
  };

  const clearAllChips = () => {
    setSearchInput("");
    setFilters((current) => ({
      ...current,
      divisionId: "",
      designationId: "",
      employmentStatus: "",
      gender: "",
      status: "",
      leaveTypeId: "",
      payrollYear: "",
      payrollMonth: "",
    }));
  };

  const handleExport = async (format) => {
    setExporting(format);

    try {
      const result = await exportReportData({ ...reportParams, exportAs: format });
      downloadBlob(result.blob, result.filename);

      /*
       * The server downgrades a format it cannot produce — XLSX falls back to CSV when the PHP zip
       * extension is missing — so announce the file that actually arrived rather than the one that
       * was asked for, and say plainly when the two differ.
       */
      const requested = format.toUpperCase();
      const delivered = (result.filename.split(".").pop() || format).toUpperCase();

      toast.success(
        delivered === requested
          ? `${delivered} export ready — ${result.filename}`
          : `${requested} is unavailable on this server — exported as ${delivered}: ${result.filename}`
      );
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || `Unable to export the report as ${format.toUpperCase()}.`);
    } finally {
      setExporting("");
    }
  };

  /**
   * The audit trail records deliberate acts (preview, print, export), not every
   * keystroke — logging each debounced refetch would bury the real entries.
   */
  const recordAction = useCallback(
    (action, format, summary) => {
      if (!report) {
        return;
      }

      logReportAction({
        reportType: report.key,
        action,
        format,
        records: report.rows?.length || 0,
        dateRangeLabel: report.dateRange?.label,
        summary,
      }).catch(() => {});
    },
    [report]
  );

  const handlePreview = () => {
    if (!report) {
      return;
    }

    setPreviewOpen(true);
    recordAction("generated", "view", `Generated "${report.label}".`);
  };

  const handlePrint = () => {
    if (!report) {
      return;
    }

    setPreviewOpen(true);
    recordAction("printed", "print", `Printed "${report.label}".`);

    // Let the drawer paint before handing off to the browser print dialog.
    setTimeout(() => window.print(), 350);
  };

  const visibleFilterControls = FILTER_CONTROLS.filter((control) => supportedFilters.includes(control.key));
  const rows = report?.rows || EMPTY_ARRAY;
  const columns = report?.columns || EMPTY_ARRAY;
  const refreshingReport = reportLoading && hasLoadedReport;
  const generatedBy = user?.full_name || user?.username || null;

  if (!category) {
    return (
      <div className="reports-dashboard">
        <section className="grid place-items-center rounded-xl border border-dashed border-slate-300 bg-white px-4 py-16 text-center">
          <div className="max-w-md">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
              <FolderTree size={22} aria-hidden="true" />
            </div>
            <h1 className="m-0 mt-4 text-lg font-semibold text-slate-900">Choose a report category</h1>
            <p className="m-0 mt-2 text-sm leading-6 text-slate-500">
              Open <strong className="font-semibold text-slate-700">Reports</strong> in the sidebar and pick a
              category to load its analytics and records.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="reports-dashboard space-y-4">

      {/* ---------------- Header ---------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="m-0 text-lg font-semibold text-slate-900">{categoryTitle}</h1>
          <p className="m-0 mt-1.5 max-w-2xl text-sm text-slate-500">
            Analytics and searchable, exportable record-level reports for this category.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton icon={Eye} onClick={handlePreview} disabled={!report}>
            Preview
          </ToolbarButton>
          <ToolbarButton icon={Printer} onClick={handlePrint} disabled={!report}>
            Print
          </ToolbarButton>
          <ToolbarButton
            icon={FileText}
            onClick={() => handleExport("pdf")}
            disabled={!report}
            busy={exporting === "pdf"}
          >
            PDF
          </ToolbarButton>
          <ToolbarButton
            icon={FileSpreadsheet}
            onClick={() => handleExport("xlsx")}
            disabled={!report}
            busy={exporting === "xlsx"}
          >
            Excel
          </ToolbarButton>
          <ToolbarButton
            icon={Sheet}
            onClick={() => handleExport("csv")}
            disabled={!report}
            busy={exporting === "csv"}
          >
            CSV
          </ToolbarButton>
        </div>
      </div>

      {/* ---------------- Filter bar ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Report</label>
            <ReportPicker catalog={categoryCatalog} value={filters.reportType} onChange={(value) => updateFilter("reportType", value)} />
          </div>

          <div>
            <label htmlFor="reports-date-range" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Date Range
            </label>
            <select
              id="reports-date-range"
              value={filters.dateRange}
              onChange={(event) => updateFilter("dateRange", event.target.value)}
              className={selectClasses}
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="reports-search" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Global Search
            </label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="reports-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Name, division, status..."
                className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              />
            </div>
          </div>

          {filters.dateRange === "custom" ? (
            <>
              <div>
                <label htmlFor="reports-custom-start" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Start Date
                </label>
                <input
                  id="reports-custom-start"
                  type="date"
                  value={filters.customStart}
                  onChange={(event) => updateFilter("customStart", event.target.value)}
                  className={selectClasses}
                />
              </div>
              <div>
                <label htmlFor="reports-custom-end" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  End Date
                </label>
                <input
                  id="reports-custom-end"
                  type="date"
                  value={filters.customEnd}
                  onChange={(event) => updateFilter("customEnd", event.target.value)}
                  className={selectClasses}
                />
              </div>
            </>
          ) : null}

          {visibleFilterControls.map((control) => (
            <div key={control.key}>
              <label htmlFor={`reports-${control.key}`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                {control.label}
              </label>
              <select
                id={`reports-${control.key}`}
                value={filters[control.key]}
                onChange={(event) => updateFilter(control.key, event.target.value)}
                className={selectClasses}
              >
                <option value="">{control.placeholder}</option>
                {(filterOptions[control.optionsKey] || EMPTY_ARRAY).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      {/* ---------------- Analytics ---------------- */}
      {showSummary ? (
        <ReportsCharts
          category={category}
          dashboard={dashboard}
          loading={dashboardLoading && !dashboard}
          refreshing={dashboardLoading && Boolean(dashboard)}
        />
      ) : null}

      {/* ---------------- Report data ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-semibold text-slate-900">{report?.label || "Report Data"}</h2>
              {report?.categoryLabel ? (
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {report.categoryLabel}
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-1 max-w-3xl text-sm text-slate-500">
              {report?.description || "Select a report to view its records."}
            </p>
            {report?.dateRange ? (
              <p className="m-0 mt-1 text-xs text-slate-400">
                {`${report.dateRange.label} · ${report.dateRange.start} to ${report.dateRange.end}`}
              </p>
            ) : null}
          </div>
        </header>

        <div className="p-4 sm:p-5">
          {report && report.available === false ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-4 py-12 text-center">
              <div className="max-w-md">
                <p className="m-0 text-sm font-semibold text-slate-700">This report is not available yet</p>
                <p className="m-0 mt-1.5 text-sm text-slate-500">
                  The database tables it reads from have not been created in this installation.
                </p>
              </div>
            </div>
          ) : (
            <ReportsDataTable
              columns={columns}
              rows={rows}
              loading={reportLoading && !hasLoadedReport}
              refreshing={refreshingReport}
              showSearch={false}
              filterChips={activeFilterChips}
              onRemoveChip={clearChip}
              onClearChips={activeFilterChips.length > 0 ? clearAllChips : undefined}
              toolbar={(
                <>
                  <ToolbarButton icon={Eye} onClick={handlePreview} disabled={!report}>
                    View
                  </ToolbarButton>
                  <ToolbarButton
                    icon={RefreshCw}
                    onClick={() => setFilters((current) => ({ ...current }))}
                    busy={refreshingReport}
                  >
                    Refresh
                  </ToolbarButton>
                </>
              )}
            />
          )}
        </div>
      </section>

      <ReportPreviewDrawer
        open={previewOpen}
        report={report}
        dateRange={report?.dateRange}
        filterChips={activeFilterChips}
        generatedBy={generatedBy}
        exporting={Boolean(exporting)}
        onClose={() => setPreviewOpen(false)}
        onPrint={handlePrint}
        onExport={handleExport}
      />
    </div>
  );
}
