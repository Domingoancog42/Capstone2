import React from "react";
import { faEye, faPrint } from "@fortawesome/free-solid-svg-icons";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import useTablePagination from "../../hooks/useTablePagination";
import useTableSort from "../../hooks/useTableSort";
import { CategoryBadge, EmployeeIdentity, TableEmptyState } from "./RewardsPrimitives";
import { categoryDetail } from "./rewardsConstants";
import { formatDate, milestoneSortValue, nominationMilestone, text } from "./rewardsUtils";

const PAGE_SIZE = 10;

const SORT_ACCESSORS = {
  certificateNumber: (row) => row.certificate?.number || "",
  employeeName: (row) => row.employeeName,
  category: (row) => categoryDetail(row.category).label,
  milestone: milestoneSortValue,
  issuedAt: (row) => row.certificate?.issuedAt || "",
};

export default function CertificatesTable({ records = [], loading = false, filtersApplied = false, onPreview, onPrint, onClearFilters }) {
  const { sortedRows, sortBy, sortDirection, toggleSort } = useTableSort(records, {
    defaultSortBy: "issuedAt",
    defaultDirection: "desc",
    accessors: SORT_ACCESSORS,
  });

  const { pageRows, currentPage, totalPages, setPage, total, rangeStart, rangeEnd } = useTablePagination(
    sortedRows,
    { pageSize: PAGE_SIZE, resetKey: `${records.length}|${sortBy}|${sortDirection}` }
  );

  const columns = [
    {
      key: "certificateNumber",
      header: "Certificate No.",
      sortable: true,
      cellClassName: "whitespace-nowrap",
      render: (row) => (
        <span className="font-mono text-sm font-bold tracking-tight text-[#D61E1E]">
          {row.certificate?.number || "—"}
        </span>
      ),
    },
    {
      key: "employeeName",
      header: "Recipient",
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
      key: "issuedAt",
      header: "Issued",
      sortable: true,
      cellClassName: "whitespace-nowrap",
      render: (row) => (
        <div>
          <p className="m-0 text-sm text-slate-700">{formatDate(row.certificate?.issuedAt)}</p>
          <p className="m-0 mt-0.5 text-xs text-slate-500">by {text(row.certificate?.issuedBy || row.reviewedBy, "—")}</p>
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
          <ActionIconButton label="Preview certificate" icon={faEye} tone="view" onClick={() => onPreview?.(row)} />
          <ActionIconButton label="Print certificate" icon={faPrint} tone="print" onClick={() => onPrint?.(row)} />
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
          loadingRows={4}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={toggleSort}
          tableClassName="min-w-[980px]"
          emptyState={
            <TableEmptyState
              title={filtersApplied ? "No certificates match these filters" : "No certificates issued yet"}
              description={
                filtersApplied
                  ? "Try a different search term or award category."
                  : "A certificate is issued automatically when a nomination is approved."
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
            <strong className="font-semibold text-slate-700">{total}</strong> certificate
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
