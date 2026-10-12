import React, { useRef, useState } from "react";
import { faFileArrowUp } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import ActionIconButton from "../UI/ActionIconButton";
import { uploadLeaveMedicalCertificate } from "../../services/leaveService";
import { getBackendAssetUrl } from "../../services/api";

export default function LeaveAttachmentUploadButton({ request, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

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

  return (
    <>
      <ActionIconButton
        label="Attachment Upload"
        text={uploading ? "Uploading..." : "Attachment Upload"}
        icon={faFileArrowUp}
        tone="edit"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp"
        aria-label="Upload medical certificate"
        className="hidden"
        disabled={uploading}
        onChange={handleFileChange}
      />
      {request.attachmentPath ? (
        <a
          href={getBackendAssetUrl(request.attachmentPath)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-2.5 py-2 text-xs font-semibold text-teal-700 hover:underline"
        >
          View medical certificate
        </a>
      ) : null}
    </>
  );
}
