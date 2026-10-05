import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { FileSpreadsheet, FileText, Loader2, Printer, Search } from "lucide-react";
import {
  exportReportData,
  getReportData,
  getReportFilterOptions,
  logReportAction,
} from "../../services/api";
import ReportPreviewDrawer from "./ReportPreviewDrawer";
import ReportsDataTable from "./ReportsDataTable";
import {
  ChartsGrid,
  KpiGrid,
  ToolbarButton,
  formatDate,
  formatHours,
  numberValue,
} from "./reportInsightWidgets";
import { buildCtoReportAnalytics, buildTravelReportAnalytics } from "./requestReportAnalytics";
import { isDivisionScopedReportDesk, scopedReportDescription, scopedReportDivision } from "./reportScope";
import { DATE_RANGE_OPTIONS, downloadBlob, localDateString } from "./reportsTheme";

/*
 * The Travel Order and CTO report screens: insight cards and charts over the record-level report,
 * with the same filters, search, print and export the Leave reports offer. One component,
 * configured per category below, so the two screens cannot drift apart.
 */

const FILTERS = {
  employeeId: { label: "Employee", optionsKey: "employees", placeholder: "All Employees" },
  divisionId: { label: "Division/Department", optionsKey: "divisions", placeholder: "All Divisions/Departments" },
  // The same four public statuses the leave reports filter on; open stages count as Pending.
  status: { label: "Status", optionsKey: "leaveStatuses", placeholder: "All Statuses" },
};

export const TRAVEL_REPORTS_CONFIG = {
  category: "travel",
  title: "Travel Order Reports",
  description: "Travel order reporting and official travel analytics",
  reports: [
    {
      key: "travel-orders",
      label: "Travel Orders",
      description: "Every travel order with destination, purpose, travel dates, days away, and status.",
      filters: ["dateRange", "employeeId", "divisionId", "status"],
    },
  ],
  buildAnalytics: buildTravelReportAnalytics,
  countKeys: ["travelDays"],
  hourKeys: [],
  dateKeys: ["dateFiled"],
  emptyMessage: "No travel orders found for the selected filters.",
  errorMessage: "Unable to generate the travel order report.",
};

export const CTO_REPORTS_CONFIG = {
  category: "cto",
  title: "Compensatory Time Off Reports",
  description: "CTO reporting and time-off credit analytics",
  reports: [
    {
      key: "cto-requests",
      label: "CTO Requests",
      description: "CTO filings with covered dates, hours applied, credit balance at filing, unpaid hours, and status.",
      filters: ["dateRange", "employeeId", "divisionId", "status"],
    },
  ],
  buildAnalytics: buildCtoReportAnalytics,
  countKeys: [],
  hourKeys: ["hoursApplied", "cocBalanceHours", "unpaidHours"],
  dateKeys: ["dateFiled"],
  emptyMessage: "No CTO requests found for the selected filters.",
  errorMessage: "Unable to generate the CTO report.",
};

const EMPTY_ROWS = [];

const selectClasses =
  "min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

export default function RequestReportsWorkspace({ user, config }) {
  const today = useMemo(() => localDateString(), []);
  const { category, reports, buildAnalytics } = config;
  const isDivisionScoped = isDivisionScopedReportDesk(user, category);
  const scopedDivision = isDivisionScoped ? scopedReportDivision(user) : "";
  const [activeKey, setActiveKey] = useState(reports[0].key);
  const [filters, setFilters] = useState({
    dateRange: "thisyear",
    customStart: today,
    customEnd: today,
    employeeId: "",
    divisionId: "",
    status: "",
  });
  const [filterOptions, setFilterOptions] = useState({});
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deferredSearch, setDeferredSearch] = useState("");
  const [exporting, setExporting] = useState("");
  const [printMode, setPrintMode] = useState(false);

  const activeReport = reports.find((entry) => entry.key === activeKey) || reports[0];
  const supportsDateRange = activeReport.filters.includes("dateRange");

  const displayValue = useCallback((key, value) => {
    if (value === null || value === undefined || value === "") return "N/A";
    if (config.hourKeys.includes(key)) return formatHours(value);
    if (config.countKeys.includes(key)) return numberValue(value).toLocaleString("en-PH");
    if (config.dateKeys.includes(key)) return formatDate(value);
    return value;
  }, [config.countKeys, config.dateKeys, config.hourKeys]);

  useEffect(() => {
    const timer = setTimeout(() => setDeferredSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    getReportFilterOptions()
      .then((payload) => {
        if (active) setFilterOptions(payload.filters || {});
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || "Unable to load report filters.");
      });
    return () => {
      active = false;
    };
  }, []);

  const reportParams = useMemo(() => {
    const params = {
      reportType: activeKey,
      dateRange: supportsDateRange ? filters.dateRange : "alltime",
    };

    if (supportsDateRange && filters.dateRange === "custom") {
      params.customStart = filters.customStart;
      params.customEnd = filters.customEnd;
    }

    activeReport.filters.forEach((key) => {
      if (key !== "dateRange" && filters[key]) params[key] = filters[key];
    });

    if (deferredSearch) params.search = deferredSearch;
    return params;
  }, [activeKey, activeReport.filters, deferredSearch, filters, supportsDateRange]);

  const customRangeIncomplete = supportsDateRange
    && filters.dateRange === "custom"
    && (!filters.customStart || !filters.customEnd);

  useEffect(() => {
    if (customRangeIncomplete) {
      setError("Select both a start and end date for the custom range.");
      return undefined;
    }

    let active = true;
    setError("");
    setRefreshing(true);

    getReportData(reportParams)
      .then((payload) => {
        if (active) setReport(payload.report || null);
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.response?.data?.message || config.errorMessage);
          setReport(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      active = false;
    };
  }, [config.errorMessage, customRangeIncomplete, reportParams]);

  const rows = useMemo(() => report?.rows || EMPTY_ROWS, [report?.rows]);
  const analytics = useMemo(() => buildAnalytics(rows), [buildAnalytics, rows]);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const optionLabel = useCallback((key, value) => {
    const meta = FILTERS[key];
    if (!meta) return value;
    const option = (filterOptions[meta.optionsKey] || []).find((entry) => String(entry.value) === String(value));
    return option?.label || value;
  }, [filterOptions]);

  const filterChips = useMemo(() => {
    const chips = [];
    if (supportsDateRange && report?.dateRange) {
      chips.push({ key: "dateRange", label: "Date Range", value: report.dateRange.label });
    }
    activeReport.filters.forEach((key) => {
      if (key === "dateRange" || !filters[key]) return;
      chips.push({ key, label: FILTERS[key]?.label || key, value: optionLabel(key, filters[key]) });
    });
    if (search.trim()) chips.push({ key: "search", label: "Search", value: search.trim() });
    return chips;
  }, [activeReport.filters, filters, optionLabel, report?.dateRange, search, supportsDateRange]);

  const clearChip = (key) => {
    if (key === "search") setSearch("");
    else if (key === "dateRange") updateFilter("dateRange", "thisyear");
    else updateFilter(key, "");
  };

  const clearAll = () => {
    setFilters((current) => ({ ...current, dateRange: "thisyear", employeeId: "", divisionId: "", status: "" }));
    setSearch("");
  };

  const handleExport = async (format) => {
    setExporting(format);
    try {
      const result = await exportReportData({ ...reportParams, search: search.trim(), exportAs: format });
      downloadBlob(result.blob, result.filename);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} report ready — ${result.filename}`);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || `Unable to export the report as ${format.toUpperCase()}.`);
    } finally {
      setExporting("");
    }
  };

  const handlePrint = () => {
    if (!report) return;
    logReportAction({
      reportType: activeKey,
      action: "printed",
      format: "print",
      records: rows.length,
      dateRangeLabel: report.dateRange?.label,
      summary: `Printed "${report.label}" with ${rows.length} matching record(s).`,
    }).catch(() => {});
    setPrintMode(true);
  };

  useEffect(() => {
    if (!printMode) return undefined;
    const handleAfterPrint = () => setPrintMode(false);
    const timer = setTimeout(() => window.print(), 350);
    window.addEventListener("afterprint", handleAfterPrint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [printMode]);

  const cellRenderers = useMemo(() => {
    const renderers = {};
    [...config.hourKeys, ...config.countKeys].forEach((key) => {
      renderers[key] = (row) => (
        <span className="whitespace-nowrap font-medium tabular-nums text-slate-900">{displayValue(key, row[key])}</span>
      );
    });
    config.dateKeys.forEach((key) => {
      renderers[key] = (row) => <span className="whitespace-nowrap text-slate-700">{displayValue(key, row[key])}</span>;
    });
    return renderers;
  }, [config.countKeys, config.dateKeys, config.hourKeys, displayValue]);

  const printableReport = useMemo(() => {
    if (!report) return null;
    return {
      ...report,
      rows: rows.map((row) => {
        const formatted = { ...row };
        report.columns.forEach((column) => {
          formatted[column.key] = displayValue(column.key, row[column.key]);
        });
        return formatted;
      }),
    };
  }, [displayValue, report, rows]);

  const generatedBy = user?.full_name || user?.username || null;
  const firstLoad = loading && !report;

  return (
    <div className="reports-dashboard space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="m-0 text-lg font-semibold text-slate-900">{config.title}</h1>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            {isDivisionScoped
              ? scopedReportDescription(scopedDivision, config.description)
              : `${config.description}.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ToolbarButton icon={Printer} onClick={handlePrint} disabled={!report}>Print Report</ToolbarButton>
          <ToolbarButton icon={FileText} onClick={() => handleExport("pdf")} busy={exporting === "pdf"} disabled={!report}>Export PDF</ToolbarButton>
          <ToolbarButton icon={FileSpreadsheet} onClick={() => handleExport("xlsx")} busy={exporting === "xlsx"} disabled={!report} primary>Export Excel</ToolbarButton>
        </div>
      </header>

      {reports.length > 1 ? (
        <nav aria-label={`${config.title} type`} className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">
          <div role="tablist" className="flex min-w-max gap-1.5">
            {reports.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={activeKey === entry.key}
                onClick={() => {
                  setActiveKey(entry.key);
                  setSearch("");
                  setReport(null);
                  setLoading(true);
                }}
                className={`min-h-[42px] rounded-lg px-4 text-sm font-semibold transition ${
                  activeKey === entry.key
                    ? "bg-[#D61E1E] text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-semibold text-slate-900">{activeReport.label}</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">{activeReport.description}</p>
          </div>
          <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 sm:inline-flex">
            Filters update automatically
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {supportsDateRange ? (
            <div>
              <label htmlFor={`${category}-report-date-range`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Date Range</label>
              <select id={`${category}-report-date-range`} value={filters.dateRange} onChange={(event) => updateFilter("dateRange", event.target.value)} className={selectClasses}>
                {DATE_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          ) : null}

          {supportsDateRange && filters.dateRange === "custom" ? (
            <>
              <div>
                <label htmlFor={`${category}-report-start`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Start Date</label>
                <input id={`${category}-report-start`} type="date" value={filters.customStart} onChange={(event) => updateFilter("customStart", event.target.value)} className={selectClasses} />
              </div>
              <div>
                <label htmlFor={`${category}-report-end`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">End Date</label>
                <input id={`${category}-report-end`} type="date" value={filters.customEnd} onChange={(event) => updateFilter("customEnd", event.target.value)} className={selectClasses} />
              </div>
            </>
          ) : null}

          {activeReport.filters.filter((key) => key !== "dateRange" && !(isDivisionScoped && key === "divisionId")).map((key) => {
            const meta = FILTERS[key];
            return (
              <div key={key}>
                <label htmlFor={`${category}-report-${key}`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{meta.label}</label>
                <select id={`${category}-report-${key}`} value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)} className={selectClasses}>
                  <option value="">{meta.placeholder}</option>
                  {(filterOptions[meta.optionsKey] || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {key === "employeeId" && option.employeeNo ? `${option.employeeNo} — ${option.label}` : option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}

      <KpiGrid kpis={analytics.kpis} loading={firstLoad} />
      <ChartsGrid charts={analytics.charts} refreshing={refreshing} />

      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div>
            <h2 className="m-0 text-base font-semibold text-slate-900">Detailed Report</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              {report?.dateRange && supportsDateRange
                ? `${report.dateRange.label}: ${formatDate(report.dateRange.start)} to ${formatDate(report.dateRange.end)}`
                : `${rows.length.toLocaleString("en-PH")} matching record${rows.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            {refreshing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Search size={13} aria-hidden="true" />}
            {refreshing ? "Updating report…" : "Search, sort, and paginate below"}
          </span>
        </header>
        <div className="p-4 sm:p-5">
          <ReportsDataTable
            columns={report?.columns || []}
            rows={rows}
            loading={firstLoad}
            refreshing={refreshing}
            selectable={false}
            showSearch
            searchValue={search}
            onSearchChange={setSearch}
            alwaysTable
            minWidth={Math.max(1100, (report?.columns?.length || 8) * 135)}
            filterChips={filterChips}
            onRemoveChip={clearChip}
            onClearChips={filterChips.length > 0 ? clearAll : undefined}
            cellRenderers={cellRenderers}
            emptyMessage={config.emptyMessage}
          />
        </div>
      </section>

      <ReportPreviewDrawer
        open={printMode}
        printOnly
        report={printableReport}
        dateRange={supportsDateRange ? report?.dateRange : null}
        filterChips={filterChips}
        generatedBy={generatedBy}
        exporting={Boolean(exporting)}
        onClose={() => setPrintMode(false)}
        onPrint={handlePrint}
        onExport={handleExport}
      />
    </div>
  );
}
