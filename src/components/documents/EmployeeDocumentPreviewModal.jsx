import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { AlertTriangle, Download, ExternalLink, FileText, LoaderCircle } from "lucide-react";
import Modal from "../UI/modal";
import Button from "../UI/button";
import { downloadBackendFile, fetchBackendFileBlob } from "../../utils/downloadBackendFile";
import {
  formatDocumentSize,
  formatDocumentTimestamp,
  isImageDocument,
  isPdfDocument,
} from "./employeeDocuments";

/**
 * Opens one stored document.
 *
 * Images and PDFs render inline; anything else only offers the file, because the browser is the one
 * deciding whether it can display it and an <iframe> that silently downloads looks like a bug.
 *
 * The file is fetched into a blob rather than framed from its URL -- see fetchBackendFileBlob() for
 * why a direct URL only works once the app is built and served by Apache.
 */
export default function EmployeeDocumentPreviewModal({
  open,
  documentItem = null,
  subtitle = "",
  onClose,
}) {
  const [objectUrl, setObjectUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const documentPath = documentItem?.path || "";
  const documentName = documentItem?.fileName || "";
  const metaParts = [
    documentItem?.typeLabel,
    formatDocumentSize(documentItem?.size),
    formatDocumentTimestamp(documentItem?.uploadedAt),
  ].filter(Boolean);

  useEffect(() => {
    if (!open || !documentPath) {
      setObjectUrl("");
      setPreviewError("");
      setPreviewLoading(false);
      return undefined;
    }

    let active = true;
    let createdUrl = "";

    setPreviewLoading(true);
    setPreviewError("");

    fetchBackendFileBlob(documentPath, documentName)
      .then((blob) => {
        if (!active) {
          return;
        }

        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((error) => {
        if (active) {
          setPreviewError(error?.message || "Unable to open this document.");
        }
      })
      .finally(() => {
        if (active) {
          setPreviewLoading(false);
        }
      });

    return () => {
      active = false;
      setObjectUrl("");

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [documentName, documentPath, open]);

  const handleDownload = async () => {
    setDownloading(true);

    try {
      await downloadBackendFile(documentPath, documentName);
    } catch (error) {
      toast.error(error?.message || "Unable to download the document.");
    } finally {
      setDownloading(false);
    }
  };

  /*
   * Portalled to <body> because the employee directory opens this from inside its own modal. A
   * `position: fixed` element is laid out against the nearest transformed ancestor rather than the
   * viewport, and the modal panel it would otherwise sit inside is animated -- so without the portal
   * this preview lands inside that panel's scroll box instead of over the page.
   */
  const modal = (
    <Modal
      open={open && Boolean(documentItem)}
      title={documentName || "Document"}
      maxWidth="max-w-[900px]"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {documentPath ? (
            <>
              <Button
                variant="secondary"
                icon={ExternalLink}
                disabled={!objectUrl}
                onClick={() => window.open(objectUrl, "_blank", "noreferrer")}
              >
                Open in new tab
              </Button>
              <Button
                variant="secondary"
                icon={Download}
                loading={downloading}
                onClick={handleDownload}
              >
                Download
              </Button>
            </>
          ) : null}
        </>
      )}
    >
      {documentItem ? (
        <div className="space-y-3">
          {metaParts.length > 0 ? (
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              {[subtitle, ...metaParts].filter(Boolean).join(" • ")}
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {previewLoading ? (
              <div className="grid place-items-center gap-2 px-4 py-12 text-center">
                <LoaderCircle className="animate-spin text-[#D61E1E]" size={26} />
                <p className="m-0 text-sm font-semibold text-slate-600">Loading document...</p>
              </div>
            ) : previewError ? (
              <div className="grid place-items-center gap-2 px-4 py-12 text-center">
                <AlertTriangle size={26} className="text-[#D61E1E]" aria-hidden="true" />
                <p className="m-0 text-sm text-slate-600">{previewError}</p>
              </div>
            ) : isImageDocument(documentItem) ? (
              <img
                src={objectUrl}
                alt={documentName || "Employee document"}
                className="mx-auto max-h-[62vh] w-auto max-w-full object-contain"
              />
            ) : isPdfDocument(documentItem) ? (
              <iframe
                src={objectUrl}
                title={documentName || "Employee document"}
                className="h-[62vh] w-full border-0 bg-white"
              />
            ) : (
              <div className="grid place-items-center gap-2 px-4 py-12 text-center">
                <FileText size={28} className="text-slate-400" aria-hidden="true" />
                <p className="m-0 text-sm text-slate-500">
                  This file type cannot be previewed here. Open or download it instead.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
