import { useCallback, useMemo, useState } from "react";

/**
 * Client-side column sorting for `components/UI/table`.
 *
 * Sort key and direction live in one state object on purpose: toggling direction from inside a
 * `setSortBy` updater would flip twice under StrictMode's double-invoked updaters.
 *
 * `accessors` maps a column key to the value to sort by, for columns whose displayed text is not
 * the raw field (a formatted date, a joined name). Pass a module-level constant — an object
 * literal declared in the component body changes identity every render and defeats the memo.
 */

function compareValues(left, right) {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";

  // Blanks sort last in either direction rather than clumping at whichever end the direction picks.
  if (leftEmpty || rightEmpty) {
    return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (left instanceof Date || right instanceof Date) {
    return new Date(left).getTime() - new Date(right).getTime();
  }

  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

export default function useTableSort(rows = [], { defaultSortBy = "", defaultDirection = "desc", accessors } = {}) {
  const [sort, setSort] = useState({ by: defaultSortBy, direction: defaultDirection });

  const toggleSort = useCallback((key) => {
    setSort((current) =>
      current.by === key
        ? { by: key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { by: key, direction: "asc" }
    );
  }, []);

  const sortedRows = useMemo(() => {
    if (!sort.by) {
      return rows;
    }

    const accessor = accessors?.[sort.by] || ((row) => row?.[sort.by]);
    const factor = sort.direction === "asc" ? 1 : -1;

    return [...rows].sort((left, right) => compareValues(accessor(left), accessor(right)) * factor);
  }, [accessors, rows, sort]);

  return {
    sortedRows,
    sortBy: sort.by,
    sortDirection: sort.direction,
    toggleSort,
  };
}
