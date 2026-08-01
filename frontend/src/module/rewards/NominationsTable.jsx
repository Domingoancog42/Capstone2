import React from "react";
import { faCertificate, faCheck, faEye, faXmark } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import useTablePagination from "../../hooks/useTablePagination";
import useTableSort from "../../hooks/useTableSort";
import { CategoryBadge, EmployeeIdentity, StatusBadge, TableEmptyState } from "./RewardsPrimitives";
import { categoryDetail } from "./rewardsConstants";
import { formatDate, milestoneSortValue, nominationMilestone, text } from "./rewardsUtils";

const PAGE_SIZE = 10;

/**
 * Declared at module scope: `useTableSort` memoises on this object's identity, so an inline literal
 * would re-sort on every render.
 */
const SORT_ACCESSORS = {
  employeeName: (row) => row.employeeName,
  category: (row) => categoryDetail(row.category).label,
  milestone: milestoneSortValue,
  nominatedBy: (row) => row.nominatedBy,
  createdAt: (row) => row.createdAt,
  status: (row) => row.status,
};

export default function NominationsTable({
  records = [],
  loading = false,
  canDecide = false,
  filtersApplied = false,
  onView,
  onApprove,
  onReject,
  onViewCertificate,
  onClearFilters,
}) {
  const { sortedRows, sortBy, sortDirection, toggleSort } = useTableSort(records, {
    defaultSortBy: "createdAt",
    defaultDirection: "desc",
    accessors: SORT_ACCESSORS,
  });

  const { pageRows, currentPage, totalPages, setPage, total, rangeStart, rangeEnd } = useTablePagination(
    sortedRows,
    { pageSize: PAGE_SIZE, resetKey: `${records.length}|${sortBy}|${sortDirection}` }
  );

  const columns = [
    {
      key: "employeeName",
      header: "Nominee",
      sortable: true,
      cellClassName: "min-w-[240px]",
      render: (row) => (
        <EmployeeIdentity
          name={row.employeeName}
          primaryMeta={[row.employeeCode, row.position].filter(Boolean).join(" · ")}
          secondaryMeta={row.division}
        />
      ),
    },
    {
      key: "category",
      header: "Award",
      sortable: true,
      render: (row) => <CategoryBadge category={row.category} compact />,
    },
    {
      key: "milestone",
      header: "Period / Milestone",
      sortable: true,
      cellClassName: "whitespace-nowrap text-sm text-slate-700",
      render: (row) => nominationMilestone(row),
    },
    {
      key: "nominatedBy",
      header: "Nominated By",
      sortable: true,
      cellClassName: "text-sm text-slate-700",
      render: (row) => text(row.nominatedBy, "—"),
    },
    {
      key: "createdAt",
      header: "Date Filed",
      sortable: true,
      cellClassName: "whitespace-nowrap text-sm text-slate-700",
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => (
        <div className="space-y-1">
          <StatusBadge status={row.status} />
          {row.reviewedBy ? (
            <p className="m-0 text-xs text-slate-500">
              by {row.reviewedBy}
              {row.reviewedAt ? ` · ${formatDate(row.reviewedAt)}` : ""}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <ActionIconButton label="View nomination" icon={faEye} tone="view" onClick={() => onView?.(row)} />
          {/* Decision buttons are hidden rather than disabled for users who cannot decide: the
              server rejects them with 403, so offering them would only produce a dead end. */}
          {canDecide && row.status === "Pending" ? (
            <>
              <ActionIconButton
                label="Approve and issue certificate"
                icon={faCheck}
                tone="approve"
                onClick={() => onApprove?.(row)}
              />
              <ActionIconButton
                label="Reject nomination"
                icon={faXmark}
                tone="reject"
                onClick={() => onReject?.(row)}
              />
            </>
          ) : null}
          {row.certificate ? (
            <ActionIconButton
              label={`View certificate ${row.certificate.number}`}
              icon={faCertificate}
              tone="print"
              onClick={() => onViewCertificate?.(row)}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <Table
          columns={columns}
          data={pageRows}
          loading={loading}
          loadingRows={5}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={toggleSort}
          tableClassName="min-w-[1080px]"
          emptyState={
            <TableEmptyState
              title={filtersApplied ? "No nominations match these filters" : "No nominations yet"}
              description={
                filtersApplied
                  ? "Try a different search term, category, or status."
                  : "Submit the first nomination to start recognising outstanding work."
              }
              action={
                filtersApplied ? (
                  <button
                    type="button"
                    onClick={onClearFilters}
                    className="text-sm font-semibold text-[#D61E1E] underline-offset-2 hover:underline"
                  >
                    Clear filters
                  </button>
                ) : null
              }
            />
          }
        />
      </div>

      {!loading && total > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-slate-500">
            Showing <strong className="font-semibold text-slate-700">{rangeStart}–{rangeEnd}</strong> of{" "}
            <strong className="font-semibold text-slate-700">{total}</strong> nomination
            {total === 1 ? "" : "s"}
          </p>
          {totalPages > 1 ? (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
