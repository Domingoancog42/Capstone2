import React, { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "react-hot-toast";
import Modal from "../UI/modal";
import Button from "../UI/button";
import EmployeeDocumentUploadFields from "./EmployeeDocumentUploadFields";
import { saveEmployeeDocumentFiles } from "../../services/employeeDocumentUploads";

export default function EmployeeDocumentRetryModal({ value, onChange }) {
  const [saving, setSaving] = useState(false);
  const retryUploads = async () => {
    if (!value || saving) return;
    setSaving(true);
    try {
      const failed = await saveEmployeeDocumentFiles(value.employee?.id, value.attachments);
      if (failed.length) {
        onChange({ ...value, attachments: failed });
        toast.error(`${failed.length} file${failed.length === 1 ? "" : "s"} could not be uploaded. Please retry.`);
      } else {
        onChange(null);
        toast.success("Employee documents uploaded successfully.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(value)}
      title="Finish Document Uploads"
      description={`Employee ${value?.employee?.fullName || "record"} was saved. Retry the remaining attachments below.`}
      maxWidth="max-w-[800px]"
      onClose={() => { if (!saving) onChange(null); }}
      footer={<Button icon={Upload} loading={saving} disabled={!value?.attachments.length} onClick={retryUploads}>Retry Uploads</Button>}
    >
      {value ? <EmployeeDocumentUploadFields value={value.attachments} onChange={(attachments) => onChange({ ...value, attachments })} disabled={saving} /> : null}
    </Modal>
  );
}
