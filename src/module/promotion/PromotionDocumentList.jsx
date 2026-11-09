import React, { useState } from "react";
import { Download, X } from "lucide-react";
import { getPromotionDocumentUrl } from "../../services/promotionService";
import { downloadBackendFile } from "../../utils/downloadBackendFile";

export default function PromotionDocumentList({ promotionId, documents, onRemove, disabled = false }) {
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  if (!Array.isArray(documents) || !documents.length) return null;
  const download = async (document) => {
    setDownloading(document.id); setError("");
    try {
      await downloadBackendFile(getPromotionDocumentUrl(promotionId, document.id), document.name);
    } catch (requestError) {
      setError(requestError?.message || "Unable to download the supporting document.");
    } finally { setDownloading(""); }
  };
  return (
    <div>
      <ul className="m-0 list-none space-y-2 p-0" aria-label="Uploaded supporting documents">
        {documents.map((document) => (
          <li key={document.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <button type="button" className="flex min-w-0 items-center gap-2 text-left text-sm text-teal-800 hover:underline disabled:opacity-50"
              onClick={() => download(document)} disabled={Boolean(downloading)} aria-label={`Download ${document.name}`}>
              <Download size={15} className="shrink-0" aria-hidden="true" />
              <span className="break-all">{document.name}<span className="ml-2 text-xs text-slate-500">{(document.size / (1024 * 1024)).toFixed(2)} MB</span></span>
            </button>
            {onRemove ? <button type="button" onClick={() => onRemove(document.id)} disabled={disabled} aria-label={`Remove ${document.name} from submission`}
              className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><X size={16} aria-hidden="true" /></button> : null}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="m-0 mt-2 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
