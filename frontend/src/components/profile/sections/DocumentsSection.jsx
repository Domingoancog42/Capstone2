import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";
import {
  AlertTriangle,
  Download,
  Eye,
  FileText,
  FolderOpen,
  LoaderCircle,
  Trash2,
  Upload,
} from "lucide-react";
import Button from "../../UI/button";
import ProfileSectionCard from "../ProfileSectionCard";
import { profileSectionAnchorId } from "../profileUtils";
import EmployeeDocumentPreviewModal from "../../documents/EmployeeDocumentPreviewModal";
import {
  EMPLOYEE_DOCUMENT_ACCEPT,
  EMPLOYEE_DOCUMENT_TYPES,
  formatDocumentSize,
  formatDocumentTimestamp,
  groupEmployeeDocuments,
  validateEmployeeDocumentFile,
} from "../../documents/employeeDocuments";
import { downloadBackendFile } from "../../../utils/downloadBackendFile";
import {
  deleteEmployeeDocument,
  getCurrentEmployeeDocuments,
  uploadEmployeeDocument,
} from "../../../services/api";

/**
 * Upload and manage the employee's personal documents.
 *
 * The listing is fetched with `self=1` rather than with the employee id the profile page matched on
 * its own: the server resolves the caller's record from the session, so an account whose local match
 * is fuzzy still lands on the right folder, and an account linked to no record gets one clear
 * message instead of an empty panel.
 */
export default function DocumentsSection({ readOnly }) {
  const [documents, setDocuments] = useState([]);
  const [employeeRecordId, setEmployeeRecordId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploadingType, setUploadingType] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [previewDocument, setPreviewDocument] = useState(null);
  const fileInputRef = useRef(null);
  const pendingTypeRef = useRef("");

  const loadDocuments = useCallback(async () => {
    setLoading(true);

    try {
      const result = await getCurrentEmployeeDocuments();
      setDocuments(result.documents || []);
      setEmployeeRecordId(Number(result.employeeId || 0));
      setLoadError("");
    } catch (error) {
      setLoadError(
        error?.response?.data?.message
        || error?.message
        || "Unable to load your documents."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const documentsByType = useMemo(() => groupEmployeeDocuments(documents), [documents]);

  const handleUploadClick = (typeId) => {
    pendingTypeRef.current = typeId;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    const typeId = pendingTypeRef.current;
    event.target.value = "";
    pendingTypeRef.current = "";

    if (!file || !typeId) {
      return;
    }

    const validationMessage = validateEmployeeDocumentFile(file);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    setUploadingType(typeId);

    try {
      const result = await uploadEmployeeDocument(employeeRecordId, typeId, file);
      setDocuments(result.documents || []);
      toast.success("Document uploaded successfully.");
    } catch (error) {
      toast.error(
        error?.response?.data?.message
        || error?.message
        || "Unable to upload the document."
      );
    } finally {
      setUploadingType("");
    }
  };

  const handleDownload = async (documentItem) => {
    setDownloadingId(documentItem.id);

    try {
      await downloadBackendFile(documentItem.path, documentItem.fileName);
    } catch (error) {
      toast.error(error?.message || "Unable to download the document.");
    } finally {
      setDownloadingId("");
    }
  };

  const handleRemove = async (documentItem) => {
    const confirmation = await Swal.fire({
      title: "Remove this document?",
      text: `${documentItem.fileName} will be deleted permanently.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#475569",
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setRemovingId(documentItem.id);

    try {
      const result = await deleteEmployeeDocument(employeeRecordId, documentItem.id);
      setDocuments(result.documents || []);
      toast.success("Document removed successfully.");
    } catch (error) {
      toast.error(
        error?.response?.data?.message
        || error?.message
        || "Unable to remove the document."
      );
    } finally {
      setRemovingId("");
    }
  };

  return (
    <ProfileSectionCard
      id={profileSectionAnchorId("documents")}
      icon={FolderOpen}
      title="Documents"
      description="Upload scanned copies of your birth certificate, valid IDs, resume, and diploma. PDF, PNG, JPG, or WEBP up to 10 MB each."
      badge={documents.length > 0 ? `${documents.length} file${documents.length === 1 ? "" : "s"}` : null}
    >
      {loading ? (
        <div className="grid min-h-[180px] place-items-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50">
          <div className="text-center">
            <LoaderCircle className="mx-auto animate-spin text-[#D61E1E]" size={24} />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-600">Loading documents...</p>
          </div>
        </div>
      ) : loadError ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-[#F8BFBF] bg-[#FEF1F1] p-4 text-[#B41818]">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[#D61E1E]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold">Documents are unavailable</p>
            <p className="m-0 mt-1 text-sm">{loadError}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            {EMPLOYEE_DOCUMENT_TYPES.map((type) => {
              const Icon = type.icon;
              const typeDocuments = documentsByType[type.id] || [];
              const isUploading = uploadingType === type.id;

              return (
                <div key={type.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[#F8BFBF] bg-[#FEF1F1] text-[#D61E1E]">
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-semibold text-slate-900">{type.label}</p>
                        <p className="m-0 mt-1 text-xs leading-5 text-slate-500">{type.description}</p>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Upload}
                      loading={isUploading}
                      disabled={readOnly || Boolean(uploadingType)}
                      onClick={() => handleUploadClick(type.id)}
                    >
                      Upload
                    </Button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {typeDocuments.length === 0 ? (
                      <p className="m-0 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                        No file uploaded yet.
                      </p>
                    ) : (
                      typeDocuments.map((documentItem) => (
                        <div
                          key={documentItem.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"
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
                          <div className="profile-document-actions flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
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
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Trash2}
                              loading={removingId === documentItem.id}
                              disabled={readOnly || Boolean(removingId)}
                              onClick={() => handleRemove(documentItem)}
                            >
                              Remove
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

          <input
            ref={fileInputRef}
            type="file"
            accept={EMPLOYEE_DOCUMENT_ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />

          <EmployeeDocumentPreviewModal
            open={Boolean(previewDocument)}
            documentItem={previewDocument}
            onClose={() => setPreviewDocument(null)}
          />
        </>
      )}
    </ProfileSectionCard>
  );
}
