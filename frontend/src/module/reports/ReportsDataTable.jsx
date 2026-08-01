import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Columns3,
  Search,
  X,
} from "lucide-react";
import Pagination from "../../components/UI/Pagination";

const DEFAULT_ROWS_PER_PAGE = 25;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const AMOUNT_PATTERN = /(pay|salary|deduction|amount|allowance|net|gross|credits)/i;

function sortValue(value) {
  if (value === null || value === undefined || value === "N/A") {
    return "";
  }

  if (typeof value === "number") {
    return value;
  }

  const text = String(value);
  const number = Number(text.replace(/,/g, ""));

  return Number.isFinite(number) && text.trim() !== "" ? number : text.toLowerCase();
}

function compareRows(key, direction) {
  return (left, right) => {
    const leftValue = sortValue(left[key]);
    const rightValue = sortValue(right[key]);

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    }

    return direction === "asc"
      ? String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true })
      : String(rightValue).localeCompare(String(leftValue), undefined, { numeric: true });
  };
}

export function statusBadgeClasses(value = "") {
  const token = String(value).trim().toLowerCase();

  if (["approved", "active", "paid", "released", "posted", "present", "completed"].includes(token)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (["pending", "reviewed", "draft", "assigned", "processing", "incomplete"].includes(token)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (["rejected", "inactive", "absent", "cancelled", "archived", "failed", "terminated"].includes(token)) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function ReportCell({ column, row, renderer }) {
  const value = row[column.key] ?? "N/A";
  const isStatus = /status/i.test(column.key);
  const isAmount = AMOUNT_PATTERN.test(column.key);

  if (renderer) {
    return renderer(row, column);
  }

  if (isStatus) {
    return (
      <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses(value)}`}>
        {value}
      </span>
    );
  }

  return (
    <span className={isAmount ? "font-semibold tabular-nums text-slate-900" : "text-slate-700"}>{value}</span>
  );
}

function ColumnVisibilityMenu({ columns, hidden, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Columns3 size={15} aria-hidden="true" />
        Columns
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1 max-h-[280px] w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
          {columns.map((column) => {
            const isVisible = !hidden.has(column.key);

            return (
              <button
                key={column.key}
                type="button"
                onClick={() => onToggle(column.key)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
              >
                <span className="truncate">{column.label}</span>
                {isVisible ? <Check size={15} className="shrink-0 text-emerald-600" aria-hidden="true" /> : null}
              </button>
            );
          })}
          <div className="mt-1 border-t border-slate-200 pt-1">
            <button
              type="button"
              onClick={onReset}
              className="w-full px-3 py-2 text-left text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Show all columns
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ReportsDataTable({
  columns = [],
  rows = [],
  loading = false,
  refreshing = false,
  filterChips = [],
  onRemoveChip,
  onClearChips,
  toolbar = null,
  selectable = true,
  onSelectionChange,
  cellRenderers = null,
  minWidth = 900,
  showSearch = true,
  emptyMessage = "No records found for the selected filters.",
}) {
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "", direction: "asc" });
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [currentPage, setCurrentPage] = useState(1);
  const [hiddenColumns, setHiddenColumns] = useState(() => new Set());
  const [columnWidths, setColumnWidths] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const resizeRef = useRef(null);

  const columnKeys = useMemo(() => columns.map((column) => column.key).join("|"), [columns]);

  // A new report brings a new column set — reset everything that is keyed to it.
  useEffect(() => {
    setSearch("");
    setSortConfig({ key: "", direction: "asc" });
    setCurrentPage(1);
    setHiddenColumns(new Set());
    setColumnWidths({});
    setSelectedKeys(new Set());
  }, [columnKeys]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rows, search, rowsPerPage]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.has(column.key)),
    [columns, hiddenColumns]
  );

  const searchedRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (term === "") {
      return rows;
    }

    return rows.filter((row) =>
      visibleColumns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(term))
    );
  }, [rows, search, visibleColumns]);

  const sortedRows = useMemo(() => {
    if (!sortConfig.key) {
      return searchedRows;
    }

    return [...searchedRows].sort(compareRows(sortConfig.key, sortConfig.direction));
  }, [searchedRows, sortConfig.direction, sortConfig.key]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * rowsPerPage;
    return sortedRows.slice(startIndex, startIndex + rowsPerPage);
  }, [rowsPerPage, safeCurrentPage, sortedRows]);

  const showingStart = sortedRows.length === 0 ? 0 : (safeCurrentPage - 1) * rowsPerPage + 1;
  const showingEnd = Math.min(safeCurrentPage * rowsPerPage, sortedRows.length);

  const rowKeyFor = useCallback(
    (row, index) => String(row.id ?? `${(safeCurrentPage - 1) * rowsPerPage + index}`),
    [rowsPerPage, safeCurrentPage]
  );

  const toggleSort = (key) => {
    setSortConfig((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { key, direction: "desc" };
      }

      return { key: "", direction: "asc" };
    });
  };

  const toggleColumn = (key) => {
    setHiddenColumns((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else if (current.size < columns.length - 1) {
        next.add(key);
      }

      return next;
    });
  };

  const updateSelection = (updater) => {
    setSelectedKeys((current) => {
      const next = updater(new Set(current));
      onSelectionChange?.(Array.from(next));
      return next;
    });
  };

  const pageKeys = paginatedRows.map(rowKeyFor);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selectedKeys.has(key));

  const startResize = (event, key) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const th = event.currentTarget.closest("th");
    const startWidth = th ? th.getBoundingClientRect().width : 160;

    resizeRef.current = { key, startX, startWidth };

    const handleMove = (moveEvent) => {
      const context = resizeRef.current;

      if (!context) {
        return;
      }

      const nextWidth = Math.max(90, context.startWidth + (moveEvent.clientX - context.startX));
      setColumnWidths((current) => ({ ...current, [context.key]: nextWidth }));
    };

    const handleUp = () => {
      resizeRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.userSelect = "";
    };

    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const columnCount = visibleColumns.length + (selectable ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {showSearch ? (
          <div className="relative w-full lg:max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search within results..."
              aria-label="Search within report results"
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            />
          </div>
        ) : (
          <span aria-hidden="true" />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <ColumnVisibilityMenu
            columns={columns}
            hidden={hiddenColumns}
            onToggle={toggleColumn}
            onReset={() => setHiddenColumns(new Set())}
          />
        </div>
      </div>

      {filterChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {filterChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-slate-700"
            >
              <span className="text-slate-500">{chip.label}:</span>
              {chip.value}
              {onRemoveChip ? (
                <button
                  type="button"
                  onClick={() => onRemoveChip(chip.key)}
                  aria-label={`Remove ${chip.label} filter`}
                  className="grid h-4 w-4 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
          {onClearChips ? (
            <button
              type="button"
              onClick={onClearChips}
              className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-slate-800 hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      {selectable && selectedKeys.size > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[#D61E1E] px-3.5 py-2 text-sm text-white dark:bg-[#21c45d]">
          <span className="font-semibold">{`${selectedKeys.size} row${selectedKeys.size === 1 ? "" : "s"} selected`}</span>
          <button
            type="button"
            onClick={() => updateSelection(() => new Set())}
            className="text-xs font-semibold text-white/80 transition hover:text-white"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className={`max-h-[620px] overflow-auto transition-opacity duration-200 ${refreshing ? "opacity-60" : "opacity-100"}`}>
          <table className="w-full border-collapse" style={{ minWidth }}>
            <thead className="sticky top-0 z-10">
              <tr>
                {selectable ? (
                  <th className="w-11 border-b border-slate-200 bg-slate-50 px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={() =>
                        updateSelection((next) => {
                          if (allPageSelected) {
                            pageKeys.forEach((key) => next.delete(key));
                          } else {
                            pageKeys.forEach((key) => next.add(key));
                          }

                          return next;
                        })
                      }
                      aria-label="Select all rows on this page"
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-slate-900"
                    />
                  </th>
                ) : null}
                {visibleColumns.map((column) => {
                  const isSorted = sortConfig.key === column.key;
                  const SortIcon = !isSorted ? ArrowUpDown : sortConfig.direction === "asc" ? ArrowUp : ArrowDown;

                  return (
                    <th
                      key={column.key}
                      style={columnWidths[column.key] ? { width: columnWidths[column.key] } : undefined}
                      className="relative border-b border-slate-200 bg-slate-50 px-4 py-3 text-left align-middle text-xs font-extrabold uppercase tracking-wide text-slate-600"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1.5 text-left uppercase transition hover:text-slate-900"
                        aria-label={`Sort by ${column.label}`}
                      >
                        {column.label}
                        <SortIcon size={12} className={isSorted ? "text-slate-900" : "text-slate-400"} aria-hidden="true" />
                      </button>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(event) => startResize(event, column.key)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-slate-300"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="animate-pulse">
                    {Array.from({ length: columnCount }).map((__, cellIndex) => (
                      <td key={`skeleton-cell-${index}-${cellIndex}`} className="border-b border-slate-200 px-4 py-3.5">
                        <div className="h-3.5 w-full max-w-[140px] rounded bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginatedRows.length > 0 ? (
                paginatedRows.map((row, index) => {
                  const key = rowKeyFor(row, index);
                  const isSelected = selectedKeys.has(key);

                  return (
                    <tr key={key} className={`transition ${isSelected ? "bg-slate-50" : "hover:bg-slate-50"}`}>
                      {selectable ? (
                        <td className="border-b border-slate-200 px-3 py-3.5 align-middle">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() =>
                              updateSelection((next) => {
                                if (next.has(key)) {
                                  next.delete(key);
                                } else {
                                  next.add(key);
                                }

                                return next;
                              })
                            }
                            aria-label={`Select row ${index + 1}`}
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-slate-900"
                          />
                        </td>
                      ) : null}
                      {visibleColumns.map((column) => (
                        <td key={column.key} className="border-b border-slate-200 px-4 py-3.5 align-middle text-sm">
                          <ReportCell column={column} row={row} renderer={cellRenderers?.[column.key]} />
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={Math.max(columnCount, 1)} className="border-b border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <p className="m-0 text-sm text-slate-600">
            {`Showing ${showingStart}-${showingEnd} of ${sortedRows.length} records`}
            {search.trim() !== "" && rows.length !== sortedRows.length ? (
              <span className="text-slate-400">{` (filtered from ${rows.length})`}</span>
            ) : null}
          </p>
          <select
            value={rowsPerPage}
            onChange={(event) => setRowsPerPage(Number(event.target.value) || DEFAULT_ROWS_PER_PAGE)}
            aria-label="Rows per page"
            className="min-h-[34px] rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none"
          >
            {ROWS_PER_PAGE_OPTIONS.map((value) => (
              <option key={value} value={value}>{`${value} / page`}</option>
            ))}
          </select>
        </div>

        <Pagination currentPage={safeCurrentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </div>
    </div>
  );
}
