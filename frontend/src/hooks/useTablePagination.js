import { useEffect, useMemo, useState } from "react";

/**
 * Page slicing for list screens, paired with `components/UI/Pagination`.
 *
 * `resetKey` should be whatever the caller filters by — changing a filter has to send the user
 * back to page 1, otherwise a narrowed result set leaves them staring at an empty page 4.
 */
export default function useTablePagination(rows = [], { pageSize = 10, resetKey = "" } = {}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamped rather than stored, so deleting the last row of the last page cannot strand the view.
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;

  const pageRows = useMemo(() => rows.slice(start, start + pageSize), [pageSize, rows, start]);

  return {
    pageRows,
    currentPage,
    totalPages,
    setPage,
    total,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, total),
  };
}
