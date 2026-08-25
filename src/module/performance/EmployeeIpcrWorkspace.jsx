import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Search,
  UploadCloud,
} from "lucide-react";
import { faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-hot-toast";
import ActionIconButton from "../../components/UI/ActionIconButton";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Pagination from "../../components/UI/Pagination";
import Table from "../../components/UI/table";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  fetchIpcrRecords,
  submitIpcrAccomplishment,
  uploadIpcrVerification,
} from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

const defaultForm = {
  actualAccomplishment: "",
  q1Rating: "",
  e2Rating: "",
  t3Rating: "",
};

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatRange(from, to) {
  return `${formatDate(from)} to ${formatDate(to)}`;
}

function ratingNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function averageRating(record) {
  const savedAverage = ratingNumber(record?.a4Rating ?? record?.finalRating);
  if (savedAverage > 0) return savedAverage.toFixed(2);

  const scores = [
    ratingNumber(record?.q1Rating),
    ratingNumber(record?.e2Rating),
    ratingNumber(record?.t3Rating),
  ].filter((score) => score > 0);

  if (scores.length === 0) return "N/A";
  return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2);
}

function statusBadge(status) {
  const normalized = String(status || "draft").toLowerCase();
  const classes = normalized.includes("rated") || normalized.includes("reviewed")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : normalized.includes("submitted")
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${classes}`}>
      {text(status, "Draft")}
    </span>
  );
}

function normalizeRecord(record = {}) {
  const ipcrId = record.ipcrId ?? record.ipcr_id ?? record.id;
  return {
    ...record,
    id: ipcrId,
    ipcrId,
    output: record.output ?? record.kpiTitle,
    kpiTitle: record.kpiTitle ?? record.output,
    successIndicator: record.successIndicator ?? record.success_indicator,
    actualAccomplishment: record.actualAccomplishment ?? record.actual_accomplishment,
    periodFrom: record.periodFrom ?? record.period_from,
    periodTo: record.periodTo ?? record.period_to,
    q1Rating: record.q1Rating ?? record.q1_rating,
    e2Rating: record.e2Rating ?? record.e2_rating,
    t3Rating: record.t3Rating ?? record.t3_rating,
    a4Rating: record.a4Rating ?? record.a4_rating,
    finalRating: record.finalRating ?? record.final_rating,
    verificationFiles: Array.isArray(record.verificationFiles) ? record.verificationFiles : [],
  };
}

function fileSizeLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmployeeIpcrWorkspace() {
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [rowsPerPage, setRowsPerPage] = useState("10");
  const [currentPage, setCurrentPage] = useState(1);

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      const response = await fetchIpcrRecords();
      setRecords((response.records || response.ipcrRecords || []).map(normalizeRecord));
    } catch (error) {
      if (!background) {
        toast.error(error?.response?.data?.message || "Unable to load your IPCR records.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadRecords, { topic: "ipcr" });

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;

    return records.filter((record) => [
      record.output,
      record.kpiTitle,
      record.successIndicator,
      record.actualAccomplishment,
      record.category,
      record.status,
    ].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [query, records]);

  const pageSize = Number(rowsPerPage) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(
    () => filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRecords, pageSize, safePage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [query, rowsPerPage]);

  const calculatedAverage = useMemo(() => {
    const scores = [form.q1Rating, form.e2Rating, form.t3Rating]
      .map(ratingNumber)
      .filter((score) => score > 0);

    if (scores.length !== 3) return "N/A";
    return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2);
  }, [form]);

  const openAccomplishment = (record) => {
    setSelectedRecord(record);
    setForm({
      actualAccomplishment: record.actualAccomplishment || "",
      q1Rating: record.q1Rating || "",
      e2Rating: record.e2Rating || "",
      t3Rating: record.t3Rating || "",
    });
    setSelectedFiles([]);
  };

  const closeAccomplishment = () => {
    if (saving) return;
    setSelectedRecord(null);
    setSelectedFiles([]);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!selectedRecord?.ipcrId) return;

    const q1 = ratingNumber(form.q1Rating);
    const e2 = ratingNumber(form.e2Rating);
    const t3 = ratingNumber(form.t3Rating);

    if (!form.actualAccomplishment.trim()) {
      toast.error("Actual accomplishment is required.");
      return;
    }

    if ([q1, e2, t3].some((score) => score <= 0 || score > 5)) {
      toast.error("Ratings must be from 1 to 5.");
      return;
    }

    setSaving(true);
    try {
      await submitIpcrAccomplishment({
        ipcr_id: selectedRecord.ipcrId,
        actual_accomplishment: form.actualAccomplishment,
        q1_rating: q1,
        e2_rating: e2,
        t3_rating: t3,
      });

      for (const file of selectedFiles) {
        await uploadIpcrVerification(selectedRecord.ipcrId, file);
      }

      toast.success("IPCR accomplishment submitted.");
      setSelectedRecord(null);
      setSelectedFiles([]);
      await loadRecords();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to submit IPCR accomplishment.");
    } finally {
      setSaving(false);
    }
  };

  /* `cardRole` / `cardFull` lay these columns out as cards below `lg` — see `components/UI/table.jsx`. */
  const columns = [
    {
      key: "output",
      header: "KPI / Output",
      cardRole: "title",
      render: (record) => <span className="font-semibold text-slate-900">{text(record.output || record.kpiTitle)}</span>,
    },
    {
      key: "successIndicator",
      header: "Success Indicator",
      cardFull: true,
      render: (record) => <span className="line-clamp-3 text-slate-700">{text(record.successIndicator)}</span>,
    },
    {
      key: "period",
      header: "Period",
      cardRole: "subtitle",
      render: (record) => formatRange(record.periodFrom, record.periodTo),
    },
    {
      key: "accomplishment",
      header: "Accomplishment",
      cardFull: true,
      render: (record) => text(record.actualAccomplishment, "Not submitted"),
    },
    {
      key: "uploads",
      header: "Uploads",
      render: (record) => `${record.verificationFiles?.length || 0} file(s)`,
    },
    {
      key: "average",
      header: "Average",
      render: (record) => averageRating(record),
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (record) => statusBadge(record.status),
    },
    {
      key: "actions",
      header: "Actions",
      cardRole: "actions",
      render: (record) => (
        <ActionIconButton
          label="Submit IPCR accomplishment"
          icon={faPenToSquare}
          tone="edit"
          text="Accomplishment"
          onClick={() => openAccomplishment(record)}
        />
      ),
    },
  ];

  const verificationFiles = selectedRecord?.verificationFiles || [];

  return (
    <section className="w-full space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">My IPCR</h3>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Review assigned IPCR KPIs, submit accomplishments, upload verification files, and add your self-rating.
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,220px)_120px]">
          <label className="relative">
            <span className="sr-only">Search my IPCR</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search KPI, indicator, status"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <select
            value={rowsPerPage}
            onChange={(event) => setRowsPerPage(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          >
            <option value="5">5 rows</option>
            <option value="10">10 rows</option>
            <option value="20">20 rows</option>
          </select>
        </div>

        {/* Plain container for the card grid below `lg`, framed box for the table from `lg` up. */}
        <div className="mt-4 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
          <Table
            columns={columns}
            data={paginatedRecords}
            loading={loading}
            loadingRows={4}
            emptyMessage="No IPCR KPIs assigned to you yet."
            tableClassName="min-w-[1180px]"
            cardsClassName="lg:hidden"
            tableWrapperClassName="hidden lg:block"
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-slate-500">
            Showing {filteredRecords.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredRecords.length)} of {filteredRecords.length} IPCR records
          </p>
          <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      </section>

      <Modal
        open={Boolean(selectedRecord)}
        title="Submit IPCR Accomplishment"
        onClose={closeAccomplishment}
        maxWidth="max-w-[900px]"
        footer={(
          <>
            <Button variant="ghost" onClick={closeAccomplishment} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="employee-ipcr-accomplishment-form" icon={CheckCircle2} loading={saving}>
              Submit
            </Button>
          </>
        )}
      >
        <form id="employee-ipcr-accomplishment-form" className="space-y-5" onSubmit={handleSubmit}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500">Assigned KPI</p>
            <p className="m-0 mt-1 font-semibold text-slate-900">{text(selectedRecord?.output || selectedRecord?.kpiTitle)}</p>
            <p className="m-0 mt-2 text-sm leading-6 text-slate-600">{text(selectedRecord?.successIndicator)}</p>
          </div>

          <div>
            <label htmlFor="actualAccomplishment" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Actual Accomplishment
            </label>
            <textarea
              id="actualAccomplishment"
              value={form.actualAccomplishment}
              onChange={(event) => setForm((current) => ({ ...current, actualAccomplishment: event.target.value }))}
              rows={5}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
              placeholder="Enter your actual accomplishment for this assigned KPI"
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <InputField
              label="Quantity"
              name="q1Rating"
              type="number"
              min="1"
              max="5"
              step="0.01"
              value={form.q1Rating}
              onChange={(event) => setForm((current) => ({ ...current, q1Rating: event.target.value }))}
              required
            />
            <InputField
              label="Efficiency"
              name="e2Rating"
              type="number"
              min="1"
              max="5"
              step="0.01"
              value={form.e2Rating}
              onChange={(event) => setForm((current) => ({ ...current, e2Rating: event.target.value }))}
              required
            />
            <InputField
              label="Timeliness"
              name="t3Rating"
              type="number"
              min="1"
              max="5"
              step="0.01"
              value={form.t3Rating}
              onChange={(event) => setForm((current) => ({ ...current, t3Rating: event.target.value }))}
              required
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="m-0 text-xs font-bold uppercase text-slate-500">Average</p>
              <p className="m-0 mt-2 text-lg font-extrabold text-slate-900">{calculatedAverage}</p>
            </div>
          </div>

          <div>
            <label htmlFor="ipcrVerificationFiles" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Documents or Photos
            </label>
            <label
              htmlFor="ipcrVerificationFiles"
              className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center transition hover:border-[#D61E1E] hover:bg-rose-50"
            >
              <UploadCloud className="text-slate-400" size={34} />
              <span className="mt-2 text-sm font-semibold text-slate-800">Choose files to upload</span>
              <span className="mt-1 text-xs text-slate-500">PDF, Word, Excel, PNG, or JPG files are accepted.</span>
            </label>
            <input
              id="ipcrVerificationFiles"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
            />
            {selectedFiles.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {selectedFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    <Paperclip size={16} className="text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{fileSizeLabel(file.size)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {verificationFiles.length > 0 ? (
            <div>
              <p className="m-0 mb-2 text-sm font-semibold text-slate-700">Current Uploaded Files</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {verificationFiles.map((file) => {
                  const fileUrl = resolveBackendAssetUrl(file.storedPath || file.path || "");
                  const isImage = String(file.mimeType || file.originalName || "").toLowerCase().match(/\bimage\/|\.png|\.jpe?g|\.gif|\.webp/);
                  return (
                    <a
                      key={file.id || fileUrl}
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 no-underline transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      {isImage ? <ImageIcon size={16} /> : <FileText size={16} />}
                      <span className="min-w-0 flex-1 truncate">{text(file.originalName || file.name, "Uploaded file")}</span>
                      <span className="shrink-0 text-xs font-normal text-slate-500">{fileSizeLabel(file.fileSize)}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}
        </form>
      </Modal>
    </section>
  );
}
