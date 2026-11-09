import React from "react";
import { formatDateDisplay } from "../../utils/leaveHelpers";
import { formatDateTime } from "../../utils/format";
import { EVALUATION_STAGES, PROMOTION_STAGES, promotionStatusLabel, STAGE_FIELD_LABELS, evaluationResultLabel } from "./promotionWorkflow";
import PromotionDocumentList from "./PromotionDocumentList";

function DetailFields({ details, promotionId }) {
  return (
    <dl className="m-0 mt-2 grid gap-1 text-sm">
      {Object.entries(details || {}).filter(([key, value]) => STAGE_FIELD_LABELS[key] && String(value ?? "").trim()).map(([key, value]) => (
        <div key={key} className="grid gap-0.5 sm:grid-cols-[155px_1fr] sm:gap-3">
          <dt className="font-medium text-slate-500">{STAGE_FIELD_LABELS[key]}</dt>
          <dd className="m-0 whitespace-pre-wrap break-words text-slate-800">
            {key === "documents" && Array.isArray(value) ? <PromotionDocumentList promotionId={promotionId} documents={value} />
              : key === "result" ? evaluationResultLabel(value) : ["reviewedOn", "scheduledOn"].includes(key) ? formatDateDisplay(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function PromotionWorkflowHistory({ promotion }) {
  const currentIndex = PROMOTION_STAGES.findIndex((stage) => stage.key === promotion.statusKey);
  return (
    <>
      <ol aria-label="Promotion progress" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {PROMOTION_STAGES.map((stage, index) => {
          const recorded = promotion.stageDetails?.[stage.key];
          const completed = stage.key === "assessment" ? recorded?.result === "qualified"
            : ["examination", "interview"].includes(stage.key) ? recorded?.result === "passed"
              : stage.key === "submission" ? Boolean(recorded?.documents?.length && currentIndex > index)
                : stage.key === "recommended" ? Boolean(promotion.recommendedAt && currentIndex > index) : false;
          return (
          <li key={stage.key} aria-current={index === currentIndex ? "step" : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs ${index === currentIndex ? "border-teal-500 bg-teal-50 font-semibold text-teal-800" : completed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>
            {index + 1}. {stage.label}
          </li>
          );
        })}
      </ol>
      {EVALUATION_STAGES.some((stage) => promotion.stageDetails?.[stage]) ? (
        <section className="rounded-2xl border border-slate-200 p-4" aria-label="Recorded evaluations">
          <h4 className="m-0 font-semibold text-slate-900">Recorded evaluations</h4>
          {EVALUATION_STAGES.filter((stage) => promotion.stageDetails?.[stage]).map((stage) => (
            <div key={stage} className="mt-3 border-t border-slate-100 pt-3">
              <p className="m-0 font-semibold text-slate-700">{promotionStatusLabel(stage)}</p>
              <DetailFields details={promotion.stageDetails[stage]} promotionId={promotion.id} />
            </div>
          ))}
        </section>
      ) : null}
      <section className="rounded-2xl border border-slate-200 p-4" aria-label="Promotion history">
        <h4 className="m-0 font-semibold text-slate-900">Stage history</h4>
        {promotion.stageHistory?.length ? (
          <ol className="m-0 mt-3 list-none space-y-3 p-0">
            {[...promotion.stageHistory].reverse().map((entry, index) => (
              <li key={index} className="border-l-2 border-teal-200 pl-3">
                <p className="m-0 text-sm font-semibold text-slate-800">
                  {entry.action === "save_stage" ? `${promotionStatusLabel(entry.toStatus)} details saved` : entry.fromStatus ? `${promotionStatusLabel(entry.fromStatus)} → ${promotionStatusLabel(entry.toStatus)}` : "Application opened for assessment"}
                </p>
                <p className="m-0 mt-0.5 text-xs text-slate-500">{entry.actorName || "User"} · {entry.actorRole} · {formatDateTime(entry.createdAt)}</p>
                {entry.note ? <p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{entry.note}</p> : null}
                {Object.keys(entry.details || {}).length ? (
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer">Evaluation recorded at this update</summary>
                    <DetailFields details={entry.details} promotionId={promotion.id} />
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="m-0 mt-2 text-sm text-slate-500">This application predates stage tracking. Its existing decision and signatories are preserved above.</p>}
      </section>
    </>
  );
}
