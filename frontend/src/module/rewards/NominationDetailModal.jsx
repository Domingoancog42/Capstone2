import React from "react";
import { Check, FileText, X } from "lucide-react";
import Button from "../../components/UI/button";
import Modal from "../../components/UI/modal";
import { CategoryBadge, EmployeeIdentity, StatusBadge } from "./RewardsPrimitives";
import { formatDate, nominationMilestone, text } from "./rewardsUtils";

function DetailRow({ label, children }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4 sm:py-3">
      <dt className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="m-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/**
 * The nomination reason is a paragraph, which is why it is here and not in the table — a prose
 * column either wraps rows to three lines or truncates the only part that explains the award.
 */
export default function NominationDetailModal({
  record,
  canDecide = false,
  onClose,
  onApprove,
  onReject,
  onViewCertificate,
}) {
  const open = Boolean(record);
  const isPending = record?.status === "Pending";
  const showDecisions = canDecide && isPending;

  return (
    <Modal
      open={open}
      title="Nomination Details"
      onClose={onClose}
      maxWidth="max-w-[680px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {record?.certificate ? (
            <Button variant="secondary" icon={FileText} onClick={() => onViewCertificate?.(record)}>
              View Certificate
            </Button>
          ) : null}
          {showDecisions ? (
            <>
              <Button variant="secondary" icon={X} onClick={() => onReject?.(record)}>
                Reject
              </Button>
              <Button icon={Check} onClick={() => onApprove?.(record)}>
                Approve
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {record ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <EmployeeIdentity
              name={record.employeeName}
              primaryMeta={[record.employeeCode, record.position].filter(Boolean).join(" · ")}
              secondaryMeta={record.division}
            />
            <StatusBadge status={record.status} />
          </div>

          <dl className="m-0">
            <DetailRow label="Award">
              <CategoryBadge category={record.category} />
            </DetailRow>
            <DetailRow label="Period / Milestone">{nominationMilestone(record)}</DetailRow>
            <DetailRow label="Employment">{text(record.employmentType, "—")}</DetailRow>
            <DetailRow label="Nominated By">{text(record.nominatedBy, "—")}</DetailRow>
            <DetailRow label="Date Filed">{formatDate(record.createdAt)}</DetailRow>
            {record.reviewedBy ? (
              <DetailRow label="Decided By">
                {record.reviewedBy}
                {record.reviewedAt ? ` · ${formatDate(record.reviewedAt)}` : ""}
              </DetailRow>
            ) : null}
            {record.certificate ? (
              <DetailRow label="Certificate">
                <span className="font-mono font-bold text-[#D61E1E]">{record.certificate.number}</span>
                <span className="ml-2 text-slate-500">issued {formatDate(record.certificate.issuedAt)}</span>
              </DetailRow>
            ) : null}
            {record.decisionNote ? <DetailRow label="Decision Note">{record.decisionNote}</DetailRow> : null}
          </dl>

          <div>
            <p className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Nomination Reason
            </p>
            <p className="m-0 whitespace-pre-line rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
              {text(record.reason, "No reason recorded.")}
            </p>
          </div>

          {showDecisions ? (
            <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-900">
              Approving issues the certificate at the same time and assigns its number. Both happen
              together and cannot be undone.
            </p>
          ) : null}

          {/* Imported records can be approved yet have no certificate: the old browser-only screen
              treated approval and issuance as two separate steps. Say so, rather than leaving the
              missing certificate looking like a bug. */}
          {record.status === "Approved" && !record.certificate ? (
            <p className="m-0 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-600">
              This nomination was approved without a certificate being issued, which only happens for
              records imported from the old browser-only screen. Newly approved nominations always
              receive one.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
