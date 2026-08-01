import React, { useCallback, useMemo, useState } from "react";
import { ClipboardList, Plus, Printer, Search, Trophy } from "lucide-react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { toast } from "react-hot-toast";
import Button from "../../components/UI/button";
import Card, { CardContent } from "../../components/UI/card";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import { SettingsNotice, SettingsSelect } from "../../components/settings";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  createRewardNomination,
  decideRewardNomination,
  fetchRewardNominations,
  importRewardNominations,
} from "../../services/api";
import CertificatesTable from "./CertificatesTable";
import NominationDetailModal from "./NominationDetailModal";
import NominationFormModal from "./NominationFormModal";
import RewardCertificate, { printCertificate } from "./RewardCertificate";
import NominationsTable from "./NominationsTable";
import { CATEGORY_OPTIONS, STATUS_OPTIONS } from "./rewardsConstants";
import {
  clearLegacyBrowserRecords,
  matchesNominationQuery,
  normalizeEmployee,
  normalizeNomination,
  readLegacyBrowserRecords,
} from "./rewardsUtils";

const TABS = [
  { key: "nominations", label: "Nominations", icon: ClipboardList },
  { key: "certificates", label: "Certificates", icon: Trophy },
];

export default function RewardsRecognitionWorkspace({ employees = [], user }) {
  const [records, setRecords] = useState([]);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [legacyRecords, setLegacyRecords] = useState(readLegacyBrowserRecords);
  const [importing, setImporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState("nominations");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [nominationOpen, setNominationOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState(null);
  const [certificatePreview, setCertificatePreview] = useState(null);

  const employeeOptions = useMemo(
    () => employees.map(normalizeEmployee).filter((employee) => employee.id && employee.name),
    [employees]
  );

  const loadNominations = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);

    try {
      const result = await fetchRewardNominations();

      setRecords((Array.isArray(result?.nominations) ? result.nominations : []).map(normalizeNomination));
      setCanDecide(Boolean(result?.canDecide));
      setLoadError("");
    } catch (requestError) {
      // A failed background poll leaves the last good list on screen rather than blanking it.
      if (!background) {
        setRecords([]);
        setLoadError(requestError.response?.data?.message || "Unable to load nominations.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefreshOnChange(loadNominations, { topic: "rewards" });

  /** Every write returns the full list, so the screen never has to guess at the new state. */
  const applyServerResult = useCallback((result) => {
    const next = (Array.isArray(result?.nominations) ? result.nominations : []).map(normalizeNomination);

    setRecords(next);

    return next;
  }, []);

  const needle = query.trim().toLowerCase();

  const filteredNominations = useMemo(
    () =>
      records.filter(
        (record) =>
          matchesNominationQuery(record, needle) &&
          (!categoryFilter || record.category === categoryFilter) &&
          (!statusFilter || record.status === statusFilter)
      ),
    [categoryFilter, needle, records, statusFilter]
  );

  const filteredCertificates = useMemo(
    () =>
      records.filter(
        (record) =>
          record.certificate &&
          matchesNominationQuery(record, needle) &&
          (!categoryFilter || record.category === categoryFilter)
      ),
    [categoryFilter, needle, records]
  );

  const certificateCount = useMemo(() => records.filter((record) => record.certificate).length, [records]);

  const nominationFiltersApplied = Boolean(needle || categoryFilter || statusFilter);
  const certificateFiltersApplied = Boolean(needle || categoryFilter);

  const clearFilters = () => {
    setQuery("");
    setCategoryFilter("");
    setStatusFilter("");
  };

  const handleImportLegacy = async () => {
    const confirmation = await Swal.fire({
      title: "Import from this browser?",
      html: `<p style="margin:0;font-size:14px;color:#475569;">
        ${legacyRecords.length} nomination(s) recorded on this computer before awards were stored on the
        server will be uploaded and become visible to everyone. Certificate numbers already issued are
        kept as they are.
      </p>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Import",
      cancelButtonText: "Not now",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    setImporting(true);

    try {
      const result = await importRewardNominations(legacyRecords);

      applyServerResult(result);
      clearLegacyBrowserRecords();
      setLegacyRecords([]);
      toast.success(result?.message || "Nominations imported.");
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Unable to import nominations.");
    } finally {
      setImporting(false);
    }
  };

  const handleNominationSubmit = async ({ employee, payload }) => {
    const confirmation = await Swal.fire({
      title: "Submit Nomination?",
      text: `${employee.name || "This employee"} will be submitted for review.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Submit Nomination",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D61E1E",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return false;
    }

    setSubmitting(true);

    try {
      const result = await createRewardNomination(payload);

      applyServerResult(result);
      setNominationOpen(false);
      toast.success(result?.message || "Nomination submitted for review.");

      return true;
    } catch (requestError) {
      const data = requestError.response?.data;

      await Swal.fire({
        title: "Not submitted",
        text: data?.message || "Unable to submit the nomination.",
        icon: "error",
        confirmButtonColor: "#D61E1E",
      });

      return data?.errors || {};
    } finally {
      setSubmitting(false);
    }
  };

  const decideNomination = async (record, decision) => {
    const isApproved = decision === "approved";

    const confirmation = await Swal.fire({
      title: isApproved ? "Approve Nomination?" : "Reject Nomination?",
      html: isApproved
        ? `<p style="margin:0;font-size:14px;color:#475569;">
             Approving <strong>${record.employeeName}</strong> issues the certificate and assigns its
             number in the same step. This cannot be undone.
           </p>`
        : `<p style="margin:0;font-size:14px;color:#475569;">
             <strong>${record.employeeName}</strong> will be marked as rejected. The nominee can be
             nominated again afterwards.
           </p>`,
      icon: isApproved ? "question" : "warning",
      showCancelButton: true,
      confirmButtonText: isApproved ? "Approve & Issue" : "Reject",
      cancelButtonText: "Cancel",
      confirmButtonColor: isApproved ? "#0f766e" : "#dc2626",
      cancelButtonColor: "#64748b",
      reverseButtons: true,
      focusCancel: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    try {
      const result = await decideRewardNomination({ id: record.id, decision });
      const next = applyServerResult(result);

      setDetailRecord(null);

      if (!isApproved) {
        toast.success(result?.message || "Nomination rejected.");
        return;
      }

      const issued = next.find((item) => item.id === record.id);

      await Swal.fire({
        title: "Certificate Issued",
        text: issued?.certificate?.number
          ? `Certificate ${issued.certificate.number} has been issued.`
          : "The nomination was approved.",
        icon: "success",
        confirmButtonColor: "#0f766e",
      });

      if (issued?.certificate) {
        setCertificatePreview(issued);
      }
    } catch (requestError) {
      await Swal.fire({
        title: "Not recorded",
        text: requestError.response?.data?.message || "Unable to record the decision.",
        icon: "error",
        confirmButtonColor: "#D61E1E",
      });
    }
  };

  const openCertificate = (record) => {
    setDetailRecord(null);
    setCertificatePreview(record);
  };

  const filterControls = (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <InputField
        label="Search"
        name="rewardSearch"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name, division, certificate no."
        icon={Search}
        className="min-w-[220px] flex-1"
      />
      <SettingsSelect
        id="rewardCategoryFilter"
        name="rewardCategoryFilter"
        label="Award"
        value={categoryFilter}
        onChange={(event) => setCategoryFilter(event.target.value)}
        options={CATEGORY_OPTIONS}
        placeholder="All awards"
        className="w-full sm:w-[200px]"
      />
      {activeTab === "nominations" ? (
        <SettingsSelect
          id="rewardStatusFilter"
          name="rewardStatusFilter"
          label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          className="w-full sm:w-[170px]"
        />
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      {loadError ? <SettingsNotice tone="error">{loadError}</SettingsNotice> : null}

      {/* Nominations made before awards moved to the server exist only in the browser that made
          them. Offer the hand-over rather than stranding them. */}
      {legacyRecords.length > 0 && canDecide ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-amber-900">
              {legacyRecords.length} nomination{legacyRecords.length === 1 ? "" : "s"} found on this computer
            </p>
            <p className="m-0 mt-1 text-sm leading-6 text-amber-800">
              These were saved before awards were stored centrally, so nobody else can see them. Import
              them to make them part of the shared record.
            </p>
          </div>
          <Button variant="secondary" loading={importing} onClick={handleImportLegacy}>
            Import
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Rewards and recognition views" className="inline-flex w-fit rounded-lg bg-slate-100 p-1">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                const count = tab.key === "nominations" ? records.length : certificateCount;

                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                      active
                        ? "border-slate-200 bg-white text-slate-950 shadow-sm"
                        : "border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-950"
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {tab.label}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        active ? "bg-[#D61E1E]/10 text-[#D61E1E]" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <Button icon={Plus} onClick={() => setNominationOpen(true)}>
              New Nomination
            </Button>
          </div>

          {filterControls}

          {activeTab === "nominations" ? (
            <NominationsTable
              records={filteredNominations}
              loading={loading}
              canDecide={canDecide}
              filtersApplied={nominationFiltersApplied}
              onView={setDetailRecord}
              onApprove={(record) => decideNomination(record, "approved")}
              onReject={(record) => decideNomination(record, "rejected")}
              onViewCertificate={openCertificate}
              onClearFilters={clearFilters}
            />
          ) : (
            <CertificatesTable
              records={filteredCertificates}
              loading={loading}
              filtersApplied={certificateFiltersApplied}
              onPreview={setCertificatePreview}
              onPrint={printCertificate}
              onClearFilters={clearFilters}
            />
          )}
        </CardContent>
      </Card>

      <NominationFormModal
        open={nominationOpen}
        employeeOptions={employeeOptions}
        submitting={submitting}
        onClose={() => setNominationOpen(false)}
        onSubmit={handleNominationSubmit}
      />

      <NominationDetailModal
        record={detailRecord}
        canDecide={canDecide}
        onClose={() => setDetailRecord(null)}
        onApprove={(record) => decideNomination(record, "approved")}
        onReject={(record) => decideNomination(record, "rejected")}
        onViewCertificate={openCertificate}
      />

      <Modal
        open={Boolean(certificatePreview)}
        title={
          certificatePreview?.certificate?.number
            ? `Certificate ${certificatePreview.certificate.number}`
            : "Certificate Preview"
        }
        onClose={() => setCertificatePreview(null)}
        maxWidth="max-w-[980px]"
        contentClassName="bg-slate-100"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCertificatePreview(null)}>
              Close
            </Button>
            <Button icon={Printer} onClick={() => printCertificate(certificatePreview)}>
              Print
            </Button>
          </>
        }
      >
        <RewardCertificate record={certificatePreview} />
      </Modal>
    </div>
  );
}
