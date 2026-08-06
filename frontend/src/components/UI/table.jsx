import React from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronsUpDown } from "lucide-react";

/**
 * The shared record table.
 *
 * `loading`, `sortBy`/`onSort`, `emptyState`, and `rowClassName` are additive — a caller that
 * passes none of them gets exactly the table it got before, so screens can adopt skeletons and
 * sorting one at a time instead of hand-rolling them per module.
 *
 * A column is `{ key, header, render?, sortable?, headerClassName?, cellClassName? }`.
 */

function SortIndicator({ active, direction }) {
  if (!active) {
    return <ChevronsUpDown size={13} className="text-slate-400" aria-hidden="true" />;
  }

  const Icon = direction === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return <Icon size={13} aria-hidden="true" />;
}

function HeaderCell({ column, sortBy, sortDirection, onSort, stickyHeader }) {
  const className = `border-b border-slate-200 bg-slate-50 px-3 py-3 text-left align-middle text-xs font-bold uppercase text-slate-600 ${
    stickyHeader ? "sticky top-0 z-10" : ""
  } ${column.headerClassName || ""}`.trim();

  if (!column.sortable || !onSort) {
    return <th className={className}>{column.header}</th>;
  }

  const active = sortBy === column.key;

  return (
    <th className={className} aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1.5 text-left text-xs font-bold uppercase transition ${
          active ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        }`}
      >
        <span>{column.header}</span>
        <SortIndicator active={active} direction={sortDirection} />
      </button>
    </th>
  );
}

function SkeletonRows({ columns, rows }) {
  return Array.from({ length: rows }).map((_, rowIndex) => (
    <tr key={`skeleton-${rowIndex}`} className="animate-pulse border-b border-slate-100">
      {columns.map((column) => (
        <td key={column.key} className="px-3 py-3">
          <div className="h-5 w-full rounded bg-slate-200" />
        </td>
      ))}
    </tr>
  ));
}

export default function Table({
  columns = [],
  data = [],
  rowKey = "id",
  emptyMessage = "No records found.",
  emptyState = null,
  loading = false,
  loadingRows = 5,
  sortBy = "",
  sortDirection = "asc",
  onSort,
  rowClassName,
  className = "",
  tableClassName = "",
  stickyHeader = false,
  /*
   * The floor the table refuses to shrink below before its wrapper starts scrolling sideways.
   * 760px suits the record tables this was written for, but a two- or three-column table has no
   * reason to force a phone into horizontal scrolling — those pass `min-w-0` or a smaller floor.
   */
  minWidthClassName = "min-w-[760px]",
}) {
  return (
    <div className={`overflow-x-auto ${className}`.trim()}>
      <table className={`${minWidthClassName} w-full border-collapse ${tableClassName}`.trim()}>
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell
                key={column.key}
                column={column}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                stickyHeader={stickyHeader}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows columns={columns} rows={loadingRows} />
          ) : data.length > 0 ? (
            data.map((row, index) => (
              <tr
                key={row[rowKey] ?? index}
                className={`border-b border-slate-100 transition hover:bg-slate-50 ${
                  typeof rowClassName === "function" ? rowClassName(row, index) || "" : rowClassName || ""
                }`.trim()}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-3 align-middle ${column.cellClassName || ""}`.trim()}
                  >
                    {column.render ? column.render(row, index) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={columns.length || 1}
                className="px-4 py-12 text-center text-sm text-slate-500"
              >
                {emptyState || emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
