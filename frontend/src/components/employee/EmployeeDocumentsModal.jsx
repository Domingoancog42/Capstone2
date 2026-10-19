import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { AlertTriangle, Download, Eye, FileText, FolderOpen, LoaderCircle, Trash2 } from "lucide-react";
import Modal from "../UI/modal";
import Button from "../UI/button";
import EmployeeDocumentPreviewModal from "../documents/EmployeeDocumentPreviewModal";
import {
  EMPLOYEE_DOCUMENT_TYPES,
  formatDocumentSize,
  formatDocumentTimestamp,
  groupEmployeeDocuments,
} from "../documents/employeeDocuments";
import { downloadBackendFile } from "../../utils/downloadBackendFile";
import { getEmployeeDocuments } from "../../services/api";

/** Responses are scoped to the employee whose documents were requested. */
export function useEmployeeDocuments(employeeRecordId, enabled = true) {
  const [state, setState] = useState({ employeeRecordId: 0, documents: [], loading: false, loadError: "" });
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!enabled || employeeRecordId <= 0) {
      setState({ employeeRecordId, documents: [], loading: false, loadError: "" });
      return undefined;
    }
    setState({ employeeRecordId, documents: [], loading: true, loadError: "" });
    getEmployeeDocuments(employeeRecordId)
      .then((result) => {
        if (active) {
          setState({ employeeRecordId, documents: result.documents || [], loading: false, loadError: "" });
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            employeeRecordId,
            documents: [],
            loading: false,
            loadError: error?.response?.data?.message || error?.message || "Unable to load this employee's documents.",
          });
        }
      });
    return () => { active = false; };
  }, [employeeRecordId, enabled, reloadVersion]);

  const replaceDocuments = useCallback((documents) => {
    setState((current) => (
      current.employeeRecordId === employeeRecordId ? { ...current, documents: documents || [] } : current
    ));
  }, [employeeRecordId]);
  const reload = useCallback(() => setReloadVersion((current) => current + 1), []);
  const isCurrentEmployee = enabled && state.employeeRecordId === employeeRecordId;
  return {
    documents: isCurrentEmployee ? state.documents : [],
    loading: enabled && employeeRecordId > 0 && (!isCurrentEmployee || state.loading),
    loadError: isCurrentEmployee ? state.loadError : "",
    replaceDocuments,
    reload,
  };
}

/** One complete listing and preview shared by the viewer and the employee editor. */
export function EmployeeDocumentList({
  employee,
  documents = [],
  loading = false,
  loadError = "",
  onRetry,
  onRemove,
  removingId = "",
  disabled = false,
  active = true,
}) {
  const [previewDocument, setPreviewDocument] = useState(null);
  const [downloadingId, setDownloadingId] = useState("");
  const documentsByType = useMemo(() => groupEmployeeDocuments(documents), [documents]);

  useEffect(() => { setPreviewDocument(null); }, [active, employee?.id]);
  useEffect(() => {
    setPreviewDocument((current) => (
      current && !documents.some((item) => item.id === current.id) ? null : current
    ));
  }, [documents]);

  const handleDownload = useCallback(async (documentItem) => {
    setDownloadingId(documentItem.id);
    try {
      await downloadBackendFile(documentItem.path, documentItem.fileName);
    } catch (error) {
      toast.error(error?.message || "Unable to download the document.");
    } finally {
      setDownloadingId("");
    }
  }, []);

  return (
    <>
      {loading ? (
        <div role="status" className="grid min-h-[160px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
          <div className="text-center">
            <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={24} />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-600">Loading documents...</p>
          </div>
        </div>
      ) : loadError ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#F8BFBF] bg-[#FEF1F1] p-4 text-[#B41818]">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[#D61E1E]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold">Documents are unavailable</p>
            <p className="m-0 mt-1 text-sm">{loadError}</p>
            {onRetry ? <Button className="mt-3" variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {EMPLOYEE_DOCUMENT_TYPES.map((type) => {
            const Icon = type.icon;
            const typeDocuments = documentsByType[type.id] || [];
            return (
              <div key={type.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#F8BFBF] bg-[#FEF1F1] text-[#D61E1E]">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <p className="m-0 text-sm font-semibold text-slate-900">{type.label}</p>
                  {typeDocuments.length > 0 ? (
                    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {typeDocuments.length} file{typeDocuments.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  {typeDocuments.length === 0 ? (
                    <p className="m-0 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">
                      No file uploaded yet.
                    </p>
                  ) : typeDocuments.map((documentItem) => (
                    <div key={documentItem.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-medium text-slate-800">{documentItem.fileName}</p>
                          <p className="m-0 text-[11px] text-slate-500">
                            {[formatDocumentSize(documentItem.size), formatDocumentTimestamp(documentItem.uploadedAt)].filter(Boolean).join(" • ")}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="ghost" size="sm" icon={Eye} onClick={() => setPreviewDocument(documentItem)}>View</Button>
                        <Button variant="secondary" size="sm" icon={Download} loading={downloadingId === documentItem.id}
                          disabled={Boolean(downloadingId)} onClick={() => handleDownload(documentItem)}>
                          Download
                        </Button>
                        {onRemove ? (
                          <Button variant="danger" size="sm" icon={Trash2} aria-label={`Remove ${documentItem.fileName}`}
                            loading={removingId === documentItem.id} disabled={disabled || Boolean(removingId)}
                            onClick={() => onRemove(documentItem)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <EmployeeDocumentPreviewModal open={Boolean(previewDocument)} documentItem={previewDocument}
        subtitle={employee?.fullName || ""} onClose={() => setPreviewDocument(null)} />
    </>
  );
}

/** Documents stored with an employee record, including every upload of each type. */
export function EmployeeDocumentsModal({ open, employee, documents = [], loading = false, loadError = "", onClose }) {
  const employeeLabel = [employee?.fullName, employee?.employeeId].filter(Boolean).join(" • ");
  // The directory nests this inside another modal; the portal keeps fixed dialogs relative to the viewport.
  const modal = (
    <Modal open={open} title="Employee Documents" maxWidth="max-w-[720px]" onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {employeeLabel ? (
        <p className="m-0 mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{employeeLabel}</p>
      ) : null}
      <EmployeeDocumentList employee={employee} documents={documents} loading={loading} loadError={loadError} active={open} />
    </Modal>
  );
  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}

/** Load the viewer's documents in advance, so its button shows a count. */
export function EmployeeDocumentDownloadButtons({ open = true, employee, className = "" }) {
  const employeeRecordId = Number(employee?.id || 0);
  const { documents, loading, loadError } = useEmployeeDocuments(employeeRecordId, open);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  useEffect(() => { if (!open) { setDocumentsOpen(false); } }, [open]);
  const hasDocuments = documents.length > 0;
  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`.trim()}>
      <Button variant="secondary" icon={FolderOpen} loading={loading} disabled={!loading && !loadError && !hasDocuments}
        title={loading ? "Loading documents..." : loadError || (hasDocuments ? "View and download uploaded documents" : "No documents uploaded.")}
        onClick={() => setDocumentsOpen(true)}>
        {hasDocuments ? `Documents (${documents.length})` : "Documents"}
      </Button>
      <EmployeeDocumentsModal open={documentsOpen} employee={employee} documents={documents} loading={loading}
        loadError={loadError} onClose={() => setDocumentsOpen(false)} />
    </div>
  );
}
