import React, { useState } from "react";
import { toast } from "react-hot-toast";
import Modal from "../../components/UI/modal";
import Button from "../../components/UI/button";
import { importServiceRecordEntries, previewServiceRecordImport } from "../../services/api";

const previewColumns = [
  ["serviceFrom", "From"], ["serviceTo", "To"], ["designationTitle", "Position"],
  ["stepIncrement", "Step"], ["employmentStatus", "Status"], ["monthlySalary", "Monthly salary"],
  ["station", "Station / Place"], ["branch", "Branch"], ["salaryGrade", "Salary grade"],
  ["separationDate", "Separation date"], ["separationCause", "Cause"], ["remarks", "Remarks"],
];

// PDFs are parsed in the browser and never uploaded, so they may be larger than Excel forms,
// which go through the PHP upload limit.
const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const formatMb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function ServiceRecordImportModal({ employee, onClose, onImported }) {
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    setEntries([]);
    setError("");
    setFileName(file?.name || "");
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name);
    if (!isPdf && !/\.xlsx$/i.test(file.name)) {
      setError("Choose an Excel (.xlsx) or PDF (.pdf) service record form.");
      return;
    }
    const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_XLSX_BYTES;
    if (file.size > maxBytes) {
      setError(`This ${isPdf ? "PDF" : "Excel file"} is ${formatMb(file.size)}; the limit is ${formatMb(maxBytes)}.`);
      return;
    }
    setBusy(true);
    try {
      const result = await previewServiceRecordImport(employee.id, file);
      setEntries(result.entries || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Unable to read this service record form.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await importServiceRecordEntries(employee.id, entries);
      toast.success(result.message || "Service record imported.");
      onImported(result);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to import the service record.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Import Service Record"
      maxWidth="max-w-6xl"
      onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <Button onClick={save} disabled={busy || !entries.length}>
          {busy ? "Processing..." : "Import Record"}
        </Button>
      </>}
    >
      <div className="space-y-4">
        <p className="m-0">Import a SERVICE RECORD form for <strong>{employee.fullName}</strong> ({employee.employeeCode}). Confirm that the form belongs to this employee before importing.</p>
        <p className="m-0 text-sm">Choose an Excel (.xlsx) form with service entries on its first worksheet (up to 10 MB), or a searchable PDF (.pdf) of up to 50 pages (up to 25 MB). Include From, To, Designation/Step, Status, Salary, and Station/Place headings. Scanned PDFs need OCR to make their text readable before import. Use MM/DD/YYYY, MM-DD-YY, or YYYY-MM-DD dates; use Present or P for an ongoing appointment.</p>
        <label className="block font-medium">
          SERVICE RECORD form
          <input className="mt-2 block w-full rounded-lg border border-slate-300 p-3 text-sm" type="file" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={chooseFile} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        {busy && <p role="status">Processing service record...</p>}
        {entries.length > 0 && <>
          <p className="m-0 font-medium">Review {entries.length} entries from {fileName}</p>
          <p className="m-0 text-sm">These entries will be added to this employee’s service record. Exact duplicates are skipped. Leave without pay from the form is retained in Remarks; the record’s leave total is calculated from attendance.</p>
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100"><tr>{previewColumns.map(([field, title]) => <th key={field} className="whitespace-nowrap p-2">{title}</th>)}</tr></thead>
              <tbody>{entries.map((entry, index) => <tr key={index} className="border-t border-slate-200">{previewColumns.map(([field]) => <td key={field} className="min-w-24 p-2">{entry[field] || (field === "serviceTo" ? "Present" : "—")}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>}
      </div>
    </Modal>
  );
}
