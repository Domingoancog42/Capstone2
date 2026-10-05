import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { AlertTriangle, Download, Eye, FileText, FolderOpen, LoaderCircle } from "lucide-react";
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

/** One employee's uploads, loaded while `enabled` is true and cleared when it goes false. */
function useEmployeeDocuments(employeeRecordId, enabled) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;

    const loadDocuments = async () => {
      if (!enabled || employeeRecordId <= 0) {
        if (mounted) {
          setDocuments([]);
          setLoading(false);
          setLoadError("");
        }
        return;
      }

      setLoading(true);
      setLoadError("");

      try {
        const result = await getEmployeeDocuments(employeeRecordId);

        if (mounted) {
          setDocuments(result.documents || []);
        }
      } catch (error) {
        if (mounted) {
          setDocuments([]);
          setLoadError(
            error?.response?.data?.message
            || error?.message
            || "Unable to load this employee's documents."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadDocuments();

    return () => {
      mounted = false;
    };
  }, [employeeRecordId, enabled]);

  return { documents, loading, loadError };
}

/**
 * Everything an employee has uploaded from Profile > Documents, for whoever is looking at their
 * record in the employee directory.
 *
 * Grouped by type and listing every file rather than only the newest of each: a re-upload does not
 * replace the previous copy on disk -- the stored name carries its own timestamp -- so showing one
 * per type left every earlier upload reachable by nobody.
 */
export function EmployeeDocumentsModal({
  open,
  employee,
  documents = [],
  loading = false,
  loadError = "",
  onClose,
}) {
  const [previewDocument, setPreviewDocument] = useState(null);
  const [downloadingId, setDownloadingId] = useState("");
  const documentsByType = useMemo(() => groupEmployeeDocuments(documents), [documents]);
  const employeeLabel = [employee?.fullName, employee?.employeeId].filter(Boolean).join(" • ");

  useEffect(() => {
    if (!open) {
      setPreviewDocument(null);
    }
  }, [open]);

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

  /*
   * Portalled to <body> for the same reason the preview is: the directory renders this from inside
   * its own modal footer, and framer-motion transforms that panel -- a `position: fixed` child is
   * then laid out against the panel rather than against the viewport.
   */
  const modal = (
    <Modal
      open={open}
      title="Employee Documents"
      maxWidth="max-w-[720px]"
      onClose={onClose}
      footer={(
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      )}
    >
      {employeeLabel ? (
        <p className="m-0 mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          {employeeLabel}
        </p>
      ) : null}

      {loading ? (
        <div className="grid min-h-[160px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
          <div className="text-center">
            <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={24} />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-600">Loading documents...</p>
          </div>
        </div>
      ) : loadError ? (
        <div className="flex items-start gap-3 rounded-xl border border-[#F8BFBF] bg-[#FEF1F1] p-4 text-[#B41818]">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[#D61E1E]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold">Documents are unavailable</p>
            <p className="m-0 mt-1 text-sm">{loadError}</p>
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
                  ) : (
                    typeDocuments.map((documentItem) => (
                      <div
                        key={documentItem.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-medium text-slate-800">
                              {documentItem.fileName}
                            </p>
                            <p className="m-0 text-[11px] text-slate-500">
                              {[
                                formatDocumentSize(documentItem.size),
                                formatDocumentTimestamp(documentItem.uploadedAt),
                              ]
                                .filter(Boolean)
                                .join(" • ")}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Eye}
                            onClick={() => setPreviewDocument(documentItem)}
                          >
                            View
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Download}
                            loading={downloadingId === documentItem.id}
                            disabled={Boolean(downloadingId)}
                            onClick={() => handleDownload(documentItem)}
                          >
                            Download
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );

  return (
    <>
      {typeof document === "undefined" ? modal : createPortal(modal, document.body)}

      <EmployeeDocumentPreviewModal
        open={Boolean(previewDocument)}
        documentItem={previewDocument}
        subtitle={employee?.fullName || ""}
        onClose={() => setPreviewDocument(null)}
      />
    </>
  );
}

/**
 * The employee directory's entry point into the documents above, rendered in the viewer's footer.
 *
 * The listing is fetched as soon as the viewer opens rather than when the button is pressed, so the
 * count sits on the button and an employee with nothing on file is obvious without a round trip.
 */
export function EmployeeDocumentDownloadButtons({ open = true, employee, className = "" }) {
  const employeeRecordId = Number(employee?.id || 0);
  const { documents, loading, loadError } = useEmployeeDocuments(employeeRecordId, open);
  const [documentsOpen, setDocumentsOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setDocumentsOpen(false);
    }
  }, [open]);

  const hasDocuments = documents.length > 0;

  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`.trim()}>
      <Button
        variant="secondary"
        icon={FolderOpen}
        loading={loading}
        disabled={!loading && !loadError && !hasDocuments}
        title={
          loading
            ? "Loading documents..."
            : loadError
              || (hasDocuments ? "View and download uploaded documents" : "No documents uploaded.")
        }
        onClick={() => setDocumentsOpen(true)}
      >
        {hasDocuments ? `Documents (${documents.length})` : "Documents"}
      </Button>

      <EmployeeDocumentsModal
        open={documentsOpen}
        employee={employee}
        documents={documents}
        loading={loading}
        loadError={loadError}
        onClose={() => setDocumentsOpen(false)}
      />
    </div>
  );
}
