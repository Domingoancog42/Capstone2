import React, { useId, useRef } from "react";
import { FolderOpen, Trash2, Upload } from "lucide-react";
import { toast } from "react-hot-toast";
import Button from "../UI/button";
import {
  EMPLOYEE_DOCUMENT_ACCEPT,
  EMPLOYEE_DOCUMENT_TYPES,
  formatDocumentSize,
  validateEmployeeDocumentFile,
} from "../documents/employeeDocuments";

const UPLOAD_TYPES = EMPLOYEE_DOCUMENT_TYPES.filter((type) => type.id !== "resume");

export default function EmployeeDocumentUploadFields({ value = [], onChange, disabled = false }) {
  const id = useId();
  const fileInputRef = useRef(null);
  const pendingTypeRef = useRef("");

  const selectFiles = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const documentType = pendingTypeRef.current;
    pendingTypeRef.current = "";
    const additions = [];
    files.forEach((file) => {
      const message = validateEmployeeDocumentFile(file);
      if (message) toast.error(`${file.name}: ${message}`);
      else if (documentType) additions.push({ documentType, file });
    });
    if (additions.length) onChange([...value, ...additions]);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 p-4">
        <FolderOpen size={20} className="mt-0.5 text-blue-700" aria-hidden="true" />
        <div>
          <h3 id={`${id}-title`} className="m-0 text-sm font-semibold text-slate-900">Documents</h3>
          <p className="m-0 mt-1 text-xs text-slate-500">Attach birth certificates, valid IDs, and diplomas. PDF, PNG, JPG, or WEBP up to 10 MB each. Files are saved with the employee record.</p>
        </div>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        {UPLOAD_TYPES.map((type) => {
          const Icon = type.icon;
          const files = value.map((item, index) => ({ ...item, index })).filter((item) => item.documentType === type.id);
          return (
            <div key={type.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon size={18} aria-hidden="true" />{type.label}</p>
                <Button type="button" size="sm" variant="secondary" icon={Upload} disabled={disabled} aria-label={`Upload ${type.label}`} onClick={() => {
                  pendingTypeRef.current = type.id;
                  fileInputRef.current.click();
                }}>Upload</Button>
              </div>
              <p className="m-0 mt-1 text-xs text-slate-500">{type.description}</p>
              <div className="mt-3 space-y-2">
                {files.length ? files.map(({ file, index }) => (
                  <div key={index} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
                    <p className="m-0 min-w-0 break-words text-xs text-slate-700">{file.name}<span className="ml-1 text-slate-500">({formatDocumentSize(file.size)})</span></p>
                    <Button type="button" variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
                  </div>
                )) : <p className="m-0 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500">No file selected.</p>}
              </div>
            </div>
          );
        })}
      </div>
      <input ref={fileInputRef} type="file" multiple accept={EMPLOYEE_DOCUMENT_ACCEPT} disabled={disabled} onChange={selectFiles} className="hidden" aria-label="Employee document files" />
    </section>
  );
}
