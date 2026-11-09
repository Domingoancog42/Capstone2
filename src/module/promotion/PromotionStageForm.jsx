import React, { useRef, useState } from "react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import { SettingsNotice, SettingsSelect } from "../../components/settings";
import { todayDateInputValue } from "../../utils/leaveHelpers";
import { nextPromotionStage, promotionStatusLabel, PROMOTION_DOCUMENT_MAX_BYTES, PROMOTION_DOCUMENT_ACCEPT } from "./promotionWorkflow";
import PromotionDocumentList from "./PromotionDocumentList";

const textareaClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100";

/** Remounted for each saved revision so unsaved edits survive background list refreshes. */
export default function PromotionStageForm({ promotion, busy, onUpdate }) {
  const stage = promotion.statusKey;
  const initial = promotion.stageDetails?.[stage] || {};
  const savedDocuments = Array.isArray(initial.documents) ? initial.documents : [];
  const [details, setDetails] = useState(() => stage === "submission"
    ? { remarks: initial.remarks || "", documentIds: savedDocuments.map((document) => document.id) }
    : { ...initial });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef(null);
  const [action, setAction] = useState("save_stage");
  const [error, setError] = useState("");
  const update = (field, value) => { setDetails((current) => ({ ...current, [field]: value })); setError(""); };
  const evaluation = stage !== "submission";
  const passingResult = stage === "assessment" ? "qualified" : "passed";
  const dateField = stage === "assessment" ? "reviewedOn" : "scheduledOn";
  const nextStage = nextPromotionStage(stage);

  const selectFile = (event) => {
    const selected = event.target.files?.[0];
    setFile(null); setError(""); setFileError("");
    if (!selected) return;
    if (selected.size <= 0 || selected.size > PROMOTION_DOCUMENT_MAX_BYTES) {
      setFileError("Choose a non-empty file of 10 MB or smaller."); event.target.value = ""; return;
    }
    if (!/\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i.test(selected.name)) {
      setFileError("Upload a PDF, PNG, JPG, WEBP, Word, or Excel document."); event.target.value = ""; return;
    }
    setFile(selected);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || fileError) return;
    if (action === "not_qualified" && !String(details.remarks || "").trim()) {
      setError("Enter the reason in Remarks before marking the applicant not qualified.");
      return;
    }
    if (action === "advance") {
      if (!details[dateField] || details[dateField] > todayDateInputValue() || details.result !== passingResult) {
        setError("Record a completed evaluation date and a passing result before advancing.");
        return;
      }
      if (stage === "examination" && !String(details.score ?? "").trim()) {
        setError("Enter the examination score before advancing."); return;
      }
      if (stage === "interview" && (!String(details.panel || "").trim() || !String(details.rating ?? "").trim())) {
        setError("Enter the interview panel and rating before advancing."); return;
      }
    }
    await onUpdate(promotion, action, {
      stage, details, note: action === "not_qualified" ? String(details.remarks || "").trim() : "",
      ...(file ? { file } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-teal-200 bg-teal-50/40 p-4" aria-label="Promotion stage evaluation">
      <div>
        <h4 className="m-0 font-semibold text-slate-900">{promotionStatusLabel(stage)}</h4>
        <p className="m-0 mt-1 text-xs text-slate-600">
          {evaluation ? "Save schedules and evaluation details here. Complete this stage before moving to the next one." : "Upload the completed requirements, then save before recommending the application to the Regional Director."}
        </p>
      </div>
      <fieldset disabled={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
        {evaluation ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              id="promotionEvaluationDate" label={stage === "assessment" ? "Assessment date" : `${promotionStatusLabel(stage)} date`}
              type="date" value={details[dateField] || ""} onChange={(event) => update(dateField, event.target.value)}
              max={stage === "assessment" ? todayDateInputValue() : undefined}
            />
            <SettingsSelect id="promotionEvaluationResult" label="Result" value={details.result || ""}
              onChange={(event) => update("result", event.target.value)} placeholder="Not yet evaluated"
              options={stage === "assessment"
                ? [{ value: "qualified", label: "Qualified" }, { value: "not_qualified", label: "Not Qualified" }]
                : [{ value: "passed", label: "Passed" }, { value: "failed", label: "Failed" }]}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="promotionSubmissionDocuments" className="mb-1.5 block text-sm font-semibold text-slate-700">Supporting requirements</label>
            <input id="promotionSubmissionDocuments" ref={fileInput} type="file" accept={PROMOTION_DOCUMENT_ACCEPT}
              onChange={selectFile} aria-describedby="promotionDocumentHelp"
              className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:font-semibold file:text-teal-800"
            />
            <p id="promotionDocumentHelp" className="m-0 mt-2 text-xs text-slate-600">Maximum 10 MB per file. PDF, PNG, JPG, WEBP, Word, or Excel. Choose a file and save to upload it; repeat to add more files.</p>
            {file || fileError ? <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm text-slate-700">
              <span className="break-all">{file ? `Ready to upload: ${file.name}` : "Choose a different file or clear the selection."}</span>
              <button type="button" className="shrink-0 text-rose-700" onClick={() => { setFile(null); setFileError(""); if (fileInput.current) fileInput.current.value = ""; }}>Clear selection</button>
            </div> : null}
            <div className="mt-3">
              <PromotionDocumentList promotionId={promotion.id} documents={savedDocuments.filter((document) => details.documentIds.includes(document.id))}
                disabled={busy} onRemove={(id) => update("documentIds", details.documentIds.filter((documentId) => documentId !== id))} />
            </div>
          </div>
        )}
        {stage === "examination" ? (
          <InputField id="promotionExamScore" label="Examination score (0–100)" type="number" min="0" max="100" step="0.01"
            value={details.score ?? ""} onChange={(event) => update("score", event.target.value)} />
        ) : null}
        {stage === "interview" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField id="promotionInterviewPanel" label="Interview panel" maxLength={4000} value={details.panel || ""} onChange={(event) => update("panel", event.target.value)} />
            <InputField id="promotionInterviewRating" label="Interview rating (0–100)" type="number" min="0" max="100" step="0.01"
              value={details.rating ?? ""} onChange={(event) => update("rating", event.target.value)} />
          </div>
        ) : null}
        <div>
          <label htmlFor="promotionStageRemarks" className="mb-1.5 block text-sm font-semibold text-slate-700">Remarks{action === "not_qualified" ? " (reason required)" : ""}</label>
          <textarea id="promotionStageRemarks" rows={3} maxLength={4000} value={details.remarks || ""}
            onChange={(event) => update("remarks", event.target.value)} className={textareaClass}
            placeholder={stage === "assessment" ? "Qualifications, experience, performance, and eligibility findings" : "Evaluation remarks or reason the applicant is not qualified"}
          />
        </div>
        <SettingsSelect id="promotionStageAction" label="Update stage" value={action}
          onChange={(event) => { setAction(event.target.value); setError(""); }}
          options={[
            { value: "save_stage", label: `Keep ${promotionStatusLabel(stage)} — save details` },
            ...(nextStage ? [{ value: "advance", label: `Move to ${promotionStatusLabel(nextStage)}` }] : []),
            ...(evaluation ? [{ value: "not_qualified", label: "Not Qualified — close application" }] : []),
          ]}
        />
        {error || fileError ? <SettingsNotice tone="error">{fileError || error}</SettingsNotice> : null}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>{action === "save_stage" ? "Save stage details" : "Update stage"}</Button>
        </div>
      </fieldset>
    </form>
  );
}
