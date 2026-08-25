import React from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronsUpDown } from "lucide-react";
import RecordCards from "./RecordCards";

/**
 * The shared record table.
 *
 * `loading`, `sortBy`/`onSort`, `emptyState`, and `rowClassName` are additive — a caller that
 * passes none of them gets exactly the table it got before, so screens can adopt skeletons and
 * sorting one at a time instead of hand-rolling them per module.
 *
 * A column is `{ key, header, render?, sortable?, headerClassName?, cellClassName? }`, plus the
 * optional card-view hints below.
 *
 * ## Card view
 *
 * Passing `cardsClassName` turns on the narrow-screen card grid (see `RecordCards`) built from the
 * same columns, and the caller pairs it with the matching `tableWrapperClassName`:
 *
 *     cardsClassName="lg:hidden"
 *     tableWrapperClassName="hidden lg:block"
 *
 * Both are written out in full because Tailwind only emits utilities it finds literally in source.
 *
 * Columns place themselves in the card through `cardRole`: `"eyebrow"`, `"title"`, `"subtitle"`,
 * `"badge"`, `"actions"`, or the default — a label/value pair in the card body. `cardLabel` gives
 * that pair its label when `header` is a node rather than a string, `cardFull` lets a long value
 * span the card's full width, and `card: false` drops a column from the card entirely.
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
        <td key={column.key} className={`px-3 py-3 ${column.cellClassName || ""}`.trim()}>
          <div className="h-5 w-full rounded bg-slate-200" />
        </td>
      ))}
    </tr>
  ));
}

/** Turns one row into the `RecordCards` descriptor, using each column's `cardRole`. */
function buildCard(columns, row, index) {
  const card = { fields: [] };

  columns.forEach((column) => {
    if (column.card === false) {
      return;
    }

    const value = column.render ? column.render(row, index) : row[column.key];

    if (value === null || value === undefined || value === "") {
      return;
    }

    switch (column.cardRole) {
      case "eyebrow":
      case "title":
      case "subtitle":
      case "badge":
        card[column.cardRole] = value;
        break;
      case "actions":
        card.actions = value;
        break;
      default:
        card.fields.push({
          label: column.cardLabel || (typeof column.header === "string" ? column.header : column.key),
          value,
          full: Boolean(column.cardFull),
        });
    }
  });

  /*
   * Every card needs something at the top. When no column claimed the title, the first field is
   * promoted into it rather than leaving the card headed by an empty line.
   */
  if (!card.title && card.fields.length) {
    const [first, ...rest] = card.fields;
    card.title = first.value;
    card.eyebrow = card.eyebrow || first.label;
    card.fields = rest;
  }

  return card;
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
  /* Set both to turn on the card view — see the card-view note above. */
  cardsClassName = "",
  tableWrapperClassName = "",
  /*
   * The floor the table refuses to shrink below before its wrapper starts scrolling sideways.
   * 760px suits the record tables this was written for, but a two- or three-column table has no
   * reason to force a phone into horizontal scrolling — those pass `min-w-0` or a smaller floor.
   */
  minWidthClassName = "min-w-[760px]",
}) {
  const table = (
    <div className={`overflow-x-auto ${className} ${tableWrapperClassName}`.replace(/\s+/g, " ").trim()}>
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

  if (!cardsClassName) {
    return table;
  }

  return (
    <>
      <RecordCards
        className={cardsClassName}
        items={data}
        itemKey={(row, index) => row[rowKey] ?? index}
        renderCard={(row, index) => buildCard(columns, row, index)}
        loading={loading}
        loadingCards={Math.min(loadingRows, 3)}
        /* Several callers pass a finished node as `emptyMessage`; only a plain string is a title. */
        empty={emptyState || (React.isValidElement(emptyMessage) ? emptyMessage : { title: emptyMessage })}
      />
      {table}
    </>
  );
}
