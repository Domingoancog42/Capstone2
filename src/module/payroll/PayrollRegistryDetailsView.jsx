import React, { useId, useMemo, useRef, useState } from "react";
import {
  Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  CreditCard, Eye, FileText, HandCoins, PieChart, Search, Users, UserRound, X,
} from "lucide-react";
import { formatCurrency, formatDate, formatDateTime, numberFormatter } from "../../utils/format";
import "./PayrollRegistryDetailsView.css";

const STATUS_LABELS = {
  Draft: "Created",
  "Pending Approval": "Pending HR Head",
  "Pending Chief": "Pending FAD Division Chief",
  "Pending Director": "Pending Director",
  Rejected: "Returned for Correction",
};
const EMPTY_ROWS = () => [];
const DEFAULT_EMPLOYEE_NAME = (record) => record.employeeName || "Employee";
const DEFAULT_RECORD_AMOUNTS = (record) => ({
  grossPay: record.grossPay,
  totalDeduction: record.totalDeduction,
  netPay: record.netPay,
  totalEarnings: record.grossPay,
});

function StatusBadge({ status = "Draft" }) {
  const tone = status === "Paid" ? "paid" : status === "Approved" ? "approved"
    : status === "Rejected" ? "returned" : status.startsWith("Pending") ? "pending" : "created";
  return <span className={`pr-status pr-status--${tone}`}>{STATUS_LABELS[status] || status}</span>;
}

function SummaryCard({ label, amount, tone, icon: Icon, compact = false }) {
  return (
    <div className={`pr-summary-card pr-summary-card--${tone}${compact ? " pr-summary-card--compact" : ""}`}>
      {Icon ? <span className="pr-summary-icon"><Icon size={23} aria-hidden="true" /></span> : null}
      <div>
        <p className="pr-summary-label">{label}</p>
        <p className="pr-summary-amount">{formatCurrency(amount)}</p>
      </div>
    </div>
  );
}

function BreakdownSection({ title, rows, totalLabel, total, gross, tone, columns = 1, icon: Icon }) {
  return (
    <section className={`pr-breakdown-section pr-breakdown-section--${tone}`} aria-label={title}>
      <h4><span><Icon size={16} aria-hidden="true" /></span>{title}</h4>
      <dl className={columns === 2 ? "pr-breakdown-list--two-columns" : undefined}>
        {rows.map((row, index) => (
          <React.Fragment key={row.key}>
            {row.group && row.group !== rows[index - 1]?.group ? (
              <>
                {row.group === "afterGross" ? <div className="pr-breakdown-gross"><dt>Gross</dt><dd>{formatCurrency(gross)}</dd></div> : null}
                <div className="pr-breakdown-group"><dt>{row.group === "beforeGross" ? "Less: Before Gross" : "Less: After Gross"}</dt><dd /></div>
              </>
            ) : null}
            <div className="pr-breakdown-row" data-deduction-group={row.group}>
              <dt>{row.onEdit ? <button type="button" className="pr-deduction-name" onClick={row.onEdit} aria-label={`Edit ${row.label} deduction`}>{row.label}</button> : row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          </React.Fragment>
        ))}
        <div className="pr-breakdown-total"><dt>{totalLabel}</dt><dd>{formatCurrency(total)}</dd></div>
      </dl>
    </section>
  );
}

function Certification({ signatories, statement }) {
  const [expanded, setExpanded] = useState(true);
  const signaturesId = useId();
  const labels = {
    certifiedServices: "Prepared by:",
    certifiedSupporting: "Reviewed by:",
    approvedBy: "Certified by:",
    paidBy: "Noted by:",
  };
  return (
    <section className="pr-certification">
      <button type="button" className="pr-certification-toggle" aria-expanded={expanded} aria-controls={signaturesId} onClick={() => setExpanded((value) => !value)}>
        <span className="pr-certification-icon"><FileText size={21} aria-hidden="true" /></span>
        <span className="pr-certification-heading">
          <strong>Approval &amp; Certification</strong>
          <span>{statement || "Payroll approval and certification signatures."}</span>
        </span>
        <ChevronDown size={18} className={expanded ? "pr-chevron-expanded" : ""} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="pr-signatures" id={signaturesId}>
          {signatories.length > 0 ? signatories.map((slot) => (
            <div className="pr-signature-card" key={slot.key}>
              <p className="pr-signature-label">{labels[slot.key] || slot.label || "Certified by:"}</p>
              <div className="pr-signature-image">
                {slot.signatureDataUrl ? <img src={slot.signatureDataUrl} alt={`${slot.name || "Approver"} signature`} /> : null}
              </div>
              <p className="pr-signature-name">{slot.name || "\u00a0"}</p>
              <p className="pr-signature-title">{slot.title || "\u00a0"}</p>
              <p className="pr-signature-date">{slot.actionDate ? formatDateTime(slot.actionDate) : "\u00a0"}</p>
            </div>
          )) : <p className="pr-signatures-empty">No certification signatures recorded yet.</p>}
        </div>
      ) : null}
    </section>
  );
}

export default function PayrollRegistryDetailsView({
  entry,
  records = [],
  totals,
  payrollType = "Salary",
  employmentSummary = "Unspecified",
  signatories = [],
  certificationStatement = "",
  actions,
  onClose,
  formatEmployeeName = DEFAULT_EMPLOYEE_NAME,
  getEarningRows = EMPTY_ROWS,
  getDeductionRows = EMPTY_ROWS,
  getRecordAmounts = DEFAULT_RECORD_AMOUNTS,
}) {
  const viewRef = useRef(null);
  const breakdownButtonRef = useRef(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("");
  const [employment, setEmployment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filterOptions = useMemo(() => ({
    divisions: [...new Set(records.map((record) => record.division || "Unassigned"))].sort(),
    employment: [...new Set(records.map((record) => record.employmentType || "Unspecified"))].sort(),
    statuses: [...new Set(records.map((record) => record.status || "Draft"))],
  }), [records]);
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => (
      (!query || [formatEmployeeName(record), record.employeeName, record.employeeId]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      && (!division || (record.division || "Unassigned") === division)
      && (!employment || (record.employmentType || "Unspecified") === employment)
      && (!status || (record.status || "Draft") === status)
    ));
  }, [records, search, division, employment, status, formatEmployeeName]);
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const visibleRecords = filteredRecords.slice(firstIndex, firstIndex + pageSize);
  const selectedRecord = records.find((record) => String(record.id) === selectedRecordId);
  const selectedAmounts = selectedRecord ? getRecordAmounts(selectedRecord) : null;
  const title = `${payrollType} Details`;

  const changeFilter = (setter, value) => { setter(value); setPage(1); };
  const clearFilters = () => { setSearch(""); setDivision(""); setEmployment(""); setStatus(""); setPage(1); };
  const closeBreakdown = () => { setSelectedRecordId(null); breakdownButtonRef.current?.focus(); };

  const renderTable = (items) => (
    <div className="pr-table-scroll">
      <table className="pr-table" aria-label="Payroll employees">
        <thead><tr>
          {["#", "Employee No.", "Employee Name", "Gross Pay", "Total Deductions", "Net Pay", "Status"].map((label) => <th scope="col" key={label}>{label}</th>)}
          <th scope="col">Action</th>
        </tr></thead>
        <tbody>
          {items.map((record, index) => {
            const amounts = getRecordAmounts(record);
            return (
            <tr key={record.id} className={String(record.id) === selectedRecordId ? "pr-row-selected" : ""}>
              <td>{firstIndex + index + 1}</td>
              <td>{record.employeeId || "N/A"}</td>
              <td className="pr-employee-name">{formatEmployeeName(record)}</td>
              <td className="pr-money">{formatCurrency(amounts.grossPay)}</td>
              <td className="pr-money">{formatCurrency(amounts.totalDeduction)}</td>
              <td className="pr-money">{formatCurrency(amounts.netPay)}</td>
              <td><StatusBadge status={record.status} /></td>
              <td>
                <button type="button" className="pr-view-button" aria-label={`View breakdown for ${formatEmployeeName(record)}`} aria-pressed={String(record.id) === selectedRecordId} onClick={(event) => {
                  breakdownButtonRef.current = event.currentTarget;
                  setSelectedRecordId(String(record.id));
                }}><Eye size={14} aria-hidden="true" />View Breakdown</button>
              </td>
            </tr>
            );
          })}
          {items.length === 0 ? <tr><td colSpan={8} className="pr-empty-table">No employees match your filters.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );

  return (
    <div ref={viewRef} className={`payroll-registry-view${selectedRecord ? " pr-has-breakdown" : ""}`} onKeyDown={(event) => {
      if (event.key === "Escape" && selectedRecord) {
        event.stopPropagation();
        closeBreakdown();
      }
      if (event.key === "Tab") {
        const focusable = [...viewRef.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <main className="pr-main">
        <header className="pr-page-header">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="pr-icon-button pr-no-print" onClick={onClose} aria-label="Close payroll details" autoFocus><X size={19} /></button>
        </header>

        <section className="pr-overview" aria-label="Payroll summary">
          <dl className="pr-metadata">
            {[
              { label: "Payroll ID", value: entry.registryId, icon: FileText },
              { label: "Pay Period", value: entry.periodLabel, icon: CalendarDays },
              { label: "Division", value: entry.division || "Unassigned", icon: Building2 },
              { label: "Date Created", value: formatDate(entry.dateCreated), icon: CalendarDays },
              { label: "Employees", value: numberFormatter.format(records.length), icon: Users },
              { label: "Employment", value: employmentSummary, icon: UserRound },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="pr-metadata-item"><Icon size={19} aria-hidden="true" /><div><dt>{label}</dt><dd title={String(value)}>{value}</dd></div></div>
            ))}
          </dl>
          <div className="pr-summary-bar">
            <div className="pr-registry-totals">
              <SummaryCard label="Gross Pay" amount={totals.totalGrossPay} tone="green" icon={HandCoins} />
              <SummaryCard label="Total Deductions" amount={totals.totalDeductions} tone="red" icon={PieChart} />
              <SummaryCard label="Net Payroll" amount={totals.totalNetPay} tone="blue" icon={CreditCard} />
            </div>
            <div className="pr-toolbar pr-no-print">
              {actions}
            </div>
          </div>
        </section>

        <section className="pr-filter-bar pr-no-print" aria-label="Filter payroll employees">
          <label className="pr-search"><Search size={19} aria-hidden="true" /><input aria-label="Search employee name or ID" type="search" placeholder="Search name or ID..." value={search} onChange={(event) => changeFilter(setSearch, event.target.value)} /></label>
          <select aria-label="Filter by division" value={division} onChange={(event) => changeFilter(setDivision, event.target.value)}><option value="">All Divisions</option>{filterOptions.divisions.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="Filter by employment type" value={employment} onChange={(event) => changeFilter(setEmployment, event.target.value)}><option value="">All Employment Types</option>{filterOptions.employment.map((value) => <option key={value}>{value}</option>)}</select>
          <select aria-label="Filter by status" value={status} onChange={(event) => changeFilter(setStatus, event.target.value)}><option value="">All Status</option>{filterOptions.statuses.map((value) => <option key={value} value={value}>{STATUS_LABELS[value] || value}</option>)}</select>
          <button type="button" className="pr-clear-filters" onClick={clearFilters}>Clear Filters</button>
        </section>

        <section className="pr-table-card" aria-label="Employee payroll registry">
          {renderTable(visibleRecords)}
          <div className="pr-table-footer">
            <p role="status">Showing {filteredRecords.length ? firstIndex + 1 : 0} to {Math.min(firstIndex + pageSize, filteredRecords.length)} of {numberFormatter.format(filteredRecords.length)} {filteredRecords.length === 1 ? "employee" : "employees"}</p>
            <div className="pr-pagination">
              <select aria-label="Rows per page" value={pageSize} onChange={(event) => changeFilter(setPageSize, Number(event.target.value))}>{[10, 20, 50, 100, 200].map((size) => <option key={size} value={size}>{size} / page</option>)}</select>
              <button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
              <span className="pr-current-page" aria-label={`Page ${currentPage} of ${totalPages}`}>{currentPage}</span>
              <button type="button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button>
            </div>
          </div>
        </section>
        <Certification signatories={signatories} statement={certificationStatement} />
      </main>

      {selectedRecord ? (
        <aside className="pr-breakdown" aria-labelledby="pr-breakdown-title">
          <header className="pr-breakdown-header"><h3 id="pr-breakdown-title">Employee Payroll Breakdown</h3><button type="button" className="pr-icon-button" onClick={closeBreakdown} aria-label="Close employee breakdown" autoFocus><X size={17} /></button></header>
          <div className="pr-breakdown-content">
            <div className="pr-employee-profile">
              <span className="pr-avatar">{[selectedRecord.lastName, selectedRecord.firstName].filter(Boolean).length === 2
                ? `${selectedRecord.lastName[0]}${selectedRecord.firstName[0]}`.toUpperCase()
                : formatEmployeeName(selectedRecord).split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span>
              <div><h4>{formatEmployeeName(selectedRecord)}</h4><p>Employee No. {selectedRecord.employeeId || "N/A"}</p><p>{selectedRecord.division || "Unassigned"}</p><p>{selectedRecord.employmentType || "Unspecified"}</p></div>
            </div>
            <div className="pr-period-card"><CalendarDays size={22} aria-hidden="true" /><div><p><strong>Pay Period:</strong> {entry.periodLabel}</p><p>Payroll ID: {entry.registryId}<span className="pr-period-divider">|</span>Date Created: {formatDate(entry.dateCreated)}</p></div></div>
            <section className="pr-employee-summary" aria-label="Employee payroll summary"><h4>Summary</h4><div className="pr-employee-totals">
              <SummaryCard label="Gross Pay" amount={selectedAmounts.grossPay} tone="green" compact />
              <SummaryCard label="Total Deductions" amount={selectedAmounts.totalDeduction} tone="red" compact />
              <SummaryCard label="Net Pay" amount={selectedAmounts.netPay} tone="blue" compact />
            </div></section>
            <BreakdownSection title="Earnings" rows={getEarningRows(selectedRecord)} totalLabel="Total Earnings" total={selectedAmounts.totalEarnings} tone="green" icon={HandCoins} />
            <BreakdownSection title="Deductions" rows={getDeductionRows(selectedRecord)} totalLabel="Total Deductions" total={selectedAmounts.totalDeduction} gross={selectedAmounts.grossPay} tone="red" columns={2} icon={PieChart} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
