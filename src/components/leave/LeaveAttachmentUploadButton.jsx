import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faFileArrowUp } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import LeaveAttachmentPreview from "./LeaveAttachmentPreview";
import { removeLeaveMedicalCertificate, uploadLeaveMedicalCertificate } from "../../services/leaveService";

export default function LeaveAttachmentUploadButton({ request, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const attachmentKey = JSON.stringify([request.id, request.attachmentPath]);
  const hasAttachment = Boolean(request.attachmentPath);
  const actionLabel = hasAttachment ? "View medical certificate" : "Upload medical certificate";

  useEffect(() => {
    setPreviewAttachment(null);
  }, [attachmentKey]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;

    if (!/\.(pdf|png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
      toast.error("Please upload your medical certificate as a PDF or image.");
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      toast.error("Medical certificate must be a non-empty file of 10 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadLeaveMedicalCertificate(request.id, file);
      onUploaded?.(result.request);
      toast.success(result.message || "Medical certificate uploaded successfully.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to upload your medical certificate.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!hasAttachment || removing) return;

    setRemoving(true);
    try {
      const result = await removeLeaveMedicalCertificate(request.id, request.attachmentPath);
      onUploaded?.(result.request);
      setPreviewAttachment(null);
      toast.success(result.message || "Medical certificate removed. You can upload a replacement.");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to remove your medical certificate.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={actionLabel}
        title={uploading ? "Uploading medical certificate..." : actionLabel}
        aria-busy={uploading || removing}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400/40 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={uploading || removing}
        onClick={() => hasAttachment ? setPreviewAttachment(attachmentKey) : inputRef.current?.click()}
      >
        <FontAwesomeIcon icon={hasAttachment ? faEye : faFileArrowUp} className="text-[12px]" aria-hidden="true" />
      </button>
      {!hasAttachment ? (
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp"
          aria-label="Upload medical certificate"
          className="hidden"
          disabled={uploading}
          onChange={handleFileChange}
        />
      ) : (
        <LeaveAttachmentPreview
          key={attachmentKey}
          open={previewAttachment === attachmentKey}
          attachmentName={request.attachmentName}
          attachmentPath={request.attachmentPath}
          onClose={() => setPreviewAttachment(null)}
          onRemove={handleRemove}
          removing={removing}
        />
      )}
    </>
  );
}
