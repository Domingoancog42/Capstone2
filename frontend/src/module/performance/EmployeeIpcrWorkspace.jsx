import React, { useCallback, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Lock,
  Paperclip,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
  UploadCloud,
  UserRoundCheck,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";
import {
  deleteIpcrVerification,
  fetchIpcrRecords,
  submitIpcrAccomplishment,
  uploadIpcrVerification,
} from "../../services/api";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";
import { orderIpcrFormRows } from "./performanceFormGroups";
import PerformanceWorkspaceHeader from "./PerformanceWorkspaceHeader";
import {
  FieldCaption,
  FilterPills,
  HubButton,
  HubEmptyState,
  MetaChip,
  RatingPill,
  RatingQuickPick,
  StatusBadge,
  WorkflowGuide,
  hubFieldClass,
} from "./PerformanceHubUI";
import RatingGuide from "./RatingGuide";
import RatingInput from "./RatingInput";
import { RATING_CRITERIA, hasCompleteScores, liveAverage } from "./KpiRatingDeck";
import { SuccessIndicatorList } from "./SuccessIndicatorsField";

/*
 * My IPCR: every KPI of one rating period in a single card. For each KPI the employee writes the
 * accomplishment, rates themselves on quantity, efficiency and timeliness, and attaches MOVs, then
 * submits them together. Their division chief checks each KPI against its MOVs and validates it --
 * keeping or adjusting the self-rating -- or returns it with a note. A returned KPI is fixed and
 * submitted again; a validated one is locked (ipcr.php enforces the same).
 */

const STAGE_FILTERS = [
  { value: "all", label: "All" },
  { value: "todo", label: "To do" },
  { value: "returned", label: "Returned" },
  { value: "submitted", label: "Submitted" },
  { value: "validated", label: "Validated" },
];

const STAGE_LABELS = { todo: "To do", returned: "Returned", submitted: "Submitted", validated: "Validated" };

const WORKFLOW_STEPS = [
  { title: "Read your targets", description: "Each KPI lists the success indicators you committed to for the rating period." },
  { title: "Self-rate & attach MOVs", description: "Write your actual accomplishment, rate yourself on quantity, efficiency and timeliness, and attach your MOVs." },
  { title: "Your chief validates", description: "Your division chief checks the MOVs and validates your rating, or returns the KPI with a note so you can fix it." },
];

const SELF_RATING_FIELDS = { q1Rating: "selfQ1Rating", e2Rating: "selfE2Rating", t3Rating: "selfT3Rating" };

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

function periodLabel(from, to) {
  if (!from || !to) return "Current period";
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(toDate.getTime())) return "Custom period";
  return `FY ${toDate.getFullYear()} - ${toDate.getMonth() < 6 ? "1st" : "2nd"} Sem`;
}

function ratingNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function averageRating(record) {
  const savedAverage = ratingNumber(record?.a4Rating ?? record?.finalRating);
  if (savedAverage > 0) return savedAverage;

  const scores = [
    ratingNumber(record?.q1Rating),
    ratingNumber(record?.e2Rating),
    ratingNumber(record?.t3Rating),
  ].filter((score) => score > 0);

  if (scores.length === 0) return 0;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2));
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
    secondIndicator: record.secondIndicator ?? record.second_indicator,
    program: record.program ?? "",
    category: record.category ?? record.kpiCategory ?? record.kpi_category ?? "",
    actualAccomplishment: record.actualAccomplishment ?? record.actual_accomplishment,
    periodFrom: record.periodFrom ?? record.period_from,
    periodTo: record.periodTo ?? record.period_to,
    q1Rating: record.q1Rating ?? record.q1_rating,
    e2Rating: record.e2Rating ?? record.e2_rating,
    t3Rating: record.t3Rating ?? record.t3_rating,
    a4Rating: record.a4Rating ?? record.a4_rating,
    finalRating: record.finalRating ?? record.final_rating,
    selfQ1Rating: record.selfQ1Rating ?? record.self_q1_rating,
    selfE2Rating: record.selfE2Rating ?? record.self_e2_rating,
    selfT3Rating: record.selfT3Rating ?? record.self_t3_rating,
    approvalRemarks: record.approvalRemarks ?? record.approval_remarks,
    reviewedByName: record.reviewedByName ?? record.reviewed_by_name,
    verificationFiles: Array.isArray(record.verificationFiles) ? record.verificationFiles : [],
  };
}

function fileSizeLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kpiKey(record) {
  return String(record?.ipcrId ?? record?.id ?? "");
}

function formKeyOf(record) {
  return `${record.periodFrom || ""}|${record.periodTo || ""}`;
}

/*
 * Where a KPI stands, from its status in ipcr.php: validated is stored as "rated" and a KPI sent
 * back by the chief as "needs_revision". Only the chief writes the final q1/e2/t3 scores; the
 * employee's own are the self_* columns.
 */
function kpiStage(record) {
  const status = String(record?.status || "").toLowerCase();
  if (status === "rated") return "validated";
  if (status === "needs_revision") return "returned";
  if (status === "submitted") return "submitted";
  return "todo";
}

/* The saved self-rating, shaped like a rating form so the KpiRatingDeck helpers read it. */
function savedSelfRating(record) {
  return Object.fromEntries(Object.entries(SELF_RATING_FIELDS).map(([name, column]) => [name, record?.[column] ?? ""]));
}

export default function EmployeeIpcrWorkspace() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingFileId, setRemovingFileId] = useState(null);
  const [selectedFormKey, setSelectedFormKey] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  /*
   * Unsaved edits, keyed by KPI: `{ actualAccomplishment, q1Rating, e2Rating, t3Rating, files,
   * touched }`. Only edited KPIs have an entry, so a background refresh of `records` never
   * overwrites what the employee is typing. `touched` marks a KPI whose MOVs already changed on the
   * server (one removed, or uploaded by a submit that then failed), so it still needs submitting.
   */
  const [drafts, setDrafts] = useState({});

  const loadRecords = useCallback(async ({ background = false } = {}) => {
    setLoading(!background);
    try {
      /*
       * Always the signed-in person's own records, whatever their role -- a chief or HR Head opening
       * My IPCR must not get the division's or everybody's list.
       */
      const response = await fetchIpcrRecords({ scope: "own" });
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

  // One form per rating period, newest first.
  const forms = useMemo(() => {
    const groups = new Map();
    records.forEach((record) => {
      const key = formKeyOf(record);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });
    return Array.from(groups, ([key, kpis]) => ({
      key,
      periodFrom: kpis[0].periodFrom,
      periodTo: kpis[0].periodTo,
      kpis: orderIpcrFormRows(kpis),
    })).sort((left, right) => String(right.periodTo || "").localeCompare(String(left.periodTo || ""))
      || String(right.periodFrom || "").localeCompare(String(left.periodFrom || "")));
  }, [records]);

  const activeForm = forms.find((form) => form.key === selectedFormKey) || forms[0] || null;
  const activeKpis = useMemo(() => activeForm?.kpis || [], [activeForm]);

  const accomplishmentOf = (record) => drafts[kpiKey(record)]?.actualAccomplishment ?? record.actualAccomplishment ?? "";
  const scoresOf = (record) => {
    const draft = drafts[kpiKey(record)];
    const saved = savedSelfRating(record);
    return Object.fromEntries(Object.keys(SELF_RATING_FIELDS).map((name) => [name, draft?.[name] ?? saved[name]]));
  };
  const filesOf = (record) => drafts[kpiKey(record)]?.files || [];
  const isChanged = (record) => {
    const draft = drafts[kpiKey(record)];
    if (!draft || kpiStage(record) === "validated") return false;
    const saved = savedSelfRating(record);
    return draft.touched
      || draft.files.length > 0
      || draft.actualAccomplishment.trim() !== String(record.actualAccomplishment || "").trim()
      || Object.keys(SELF_RATING_FIELDS).some((name) => ratingNumber(draft[name]) !== ratingNumber(saved[name]));
  };

  const stageCounts = useMemo(() => {
    const counts = { all: activeKpis.length, todo: 0, returned: 0, submitted: 0, validated: 0 };
    activeKpis.forEach((record) => { counts[kpiStage(record)] += 1; });
    return counts;
  }, [activeKpis]);
  const visibleKpis = stageFilter === "all" ? activeKpis : activeKpis.filter((record) => kpiStage(record) === stageFilter);

  const pendingKpis = activeKpis.filter(isChanged);
  const validatedKpis = activeKpis.filter((record) => kpiStage(record) === "validated");
  const sentCount = stageCounts.submitted + stageCounts.validated;
  const finalAverage = validatedKpis.length > 0
    ? (validatedKpis.reduce((sum, record) => sum + averageRating(record), 0) / validatedKpis.length).toFixed(2)
    : "";
  // Until every KPI is validated the average covers only some of them, so it is not called final.
  const allValidated = activeKpis.length > 0 && validatedKpis.length === activeKpis.length;
  const ratingLabel = allValidated ? "Final rating" : "Rating so far";
  const sentShare = activeKpis.length > 0 ? Math.round((sentCount / activeKpis.length) * 100) : 0;
  const formStatus = allValidated
    ? "Validated"
    : validatedKpis.length > 0
    ? "Partially validated"
    : stageCounts.returned > 0
    ? "Returned"
    : stageCounts.submitted > 0
    ? "Submitted"
    : "Draft";

  // A KPI's first edit seeds its draft from what is saved, so untouched fields keep their values.
  const updateDraft = (record, changes) => {
    const key = kpiKey(record);
    setDrafts((current) => {
      const base = current[key] || {
        actualAccomplishment: record.actualAccomplishment ?? "",
        ...savedSelfRating(record),
        files: [],
        touched: false,
      };
      return { ...current, [key]: { ...base, ...changes } };
    });
  };

  const addFiles = (record, fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;
    const existing = filesOf(record);
    const known = new Set(existing.map((file) => `${file.name}:${file.size}`));
    updateDraft(record, { files: [...existing, ...picked.filter((file) => !known.has(`${file.name}:${file.size}`))] });
  };

  const removeFile = (record, target) => {
    updateDraft(record, { files: filesOf(record).filter((file) => file !== target) });
  };

  /* Deletes a MOV that is already uploaded. The KPI then needs submitting again to reach the chief. */
  const removeSavedFile = async (record, file) => {
    const name = text(file.originalName || file.name, "this file");
    if (!window.confirm(`Remove ${name}? The file is deleted from this KPI's MOVs.`)) return;

    setRemovingFileId(file.id);
    try {
      await deleteIpcrVerification(file.id);
      updateDraft(record, { touched: true });
      toast.success("MOV removed. Submit the KPI again when it is ready.");
      await loadRecords({ background: true });
    } catch (error) {
      toast.error(error?.response?.data?.message || "Unable to remove the MOV.");
    } finally {
      setRemovingFileId(null);
    }
  };

  const discardDraft = (record) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[kpiKey(record)];
      return next;
    });
  };

  const discardAll = () => {
    setDrafts((current) => {
      const next = { ...current };
      activeKpis.forEach((record) => { delete next[kpiKey(record)]; });
      return next;
    });
  };

  const focusKpi = (record, field = "accomplishment") => {
    const key = kpiKey(record);
    document.getElementById(`my-ipcr-kpi-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    document.getElementById(`my-ipcr-${key}-${field}`)?.focus();
  };

  /*
   * Submits every changed KPI of the period for validation. The new MOVs upload first, since the
   * server will not take a KPI without one, then one call submits every accomplishment and
   * self-rating together -- all of them or, if one is refused, none. MOVs that uploaded before a
   * failure stay uploaded, and their KPIs keep the rest of their edits for another try.
   */
  const handleSubmit = async () => {
    if (pendingKpis.length === 0) {
      toast.error("No changes to submit. Write an accomplishment, rate yourself, or attach a MOV first.");
      return;
    }

    for (const record of pendingKpis) {
      const position = activeKpis.indexOf(record) + 1;
      const block = (message, field) => {
        if (stageFilter !== "all") setStageFilter("all");
        toast.error(message);
        focusKpi(record, field);
      };

      if (!text(accomplishmentOf(record), "")) {
        block(`Write the accomplishment for KPI ${position} before submitting it.`, "accomplishment");
        return;
      }
      if (!hasCompleteScores(scoresOf(record))) {
        block(`Rate KPI ${position} on quantity, efficiency and timeliness, from 1 to 5, before submitting it.`, "q1Rating");
        return;
      }
      if ((record.verificationFiles?.length || 0) + filesOf(record).length === 0) {
        block(`Attach at least one MOV to KPI ${position} before submitting it.`, "files");
        return;
      }
    }

    setSaving(true);
    const uploaded = new Map();
    let submitted = false;
    try {
      for (const record of pendingKpis) {
        const key = kpiKey(record);
        for (const file of filesOf(record)) {
          await uploadIpcrVerification(record.ipcrId, file);
          uploaded.set(key, (uploaded.get(key) || 0) + 1);
        }
      }

      await submitIpcrAccomplishment({
        kpis: pendingKpis.map((record) => {
          const scores = scoresOf(record);
          return {
            ipcr_id: record.ipcrId,
            actual_accomplishment: accomplishmentOf(record).trim(),
            q1_rating: ratingNumber(scores.q1Rating),
            e2_rating: ratingNumber(scores.e2Rating),
            t3_rating: ratingNumber(scores.t3Rating),
          };
        }),
      });
      submitted = true;
      toast.success(pendingKpis.length === 1
        ? "IPCR KPI submitted for validation."
        : `${pendingKpis.length} IPCR KPIs submitted for validation.`);
    } catch (error) {
      const message = error?.response?.data?.message || "Unable to submit your IPCR.";
      toast.error(uploaded.size > 0 ? `${message} The MOVs that uploaded are saved; submit again to finish.` : message);
    } finally {
      setDrafts((current) => {
        const next = { ...current };
        if (submitted) {
          pendingKpis.forEach((record) => { delete next[kpiKey(record)]; });
        } else {
          // A KPI keeps only the files that did not upload, and stays pending for the retry.
          uploaded.forEach((count, key) => {
            if (next[key]) next[key] = { ...next[key], files: next[key].files.slice(count), touched: true };
          });
        }
        return next;
      });
      if (submitted || uploaded.size > 0) await loadRecords({ background: true });
      setSaving(false);
    }
  };

  const metrics = [
    {
      label: "Assigned KPIs",
      value: activeKpis.length,
      icon: ListChecks,
      accent: "accent",
      sub: activeForm ? periodLabel(activeForm.periodFrom, activeForm.periodTo) : "No rating period yet",
    },
    {
      label: "Submitted",
      value: `${sentCount}/${activeKpis.length}`,
      icon: ClipboardList,
      accent: "sky",
      sub: "Self-rated with MOVs",
    },
    {
      label: "Awaiting validation",
      value: stageCounts.submitted,
      icon: Clock3,
      accent: "amber",
      sub: stageCounts.returned > 0
        ? `${stageCounts.returned} returned to you`
        : "With your division chief",
    },
    {
      label: ratingLabel,
      value: finalAverage || "—",
      icon: CheckCircle2,
      accent: "emerald",
      sub: `${validatedKpis.length} of ${activeKpis.length} KPIs validated`,
    },
  ];

  return (
    <section className="performance-hub w-full space-y-5">
      <PerformanceWorkspaceHeader
        title="My IPCR"
        description="Write your accomplishment, rate yourself, and attach your MOVs for every assigned KPI, then submit them to your division chief for validation."
        icon={UserRoundCheck}
        metrics={metrics}
        loading={loading && records.length > 0}
        action={(
          <HubButton variant="outline" icon={RefreshCw} loading={loading} onClick={() => loadRecords()}>
            Refresh
          </HubButton>
        )}
      />

      {/* How the form works comes first, before the employee starts on their KPIs. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <WorkflowGuide title="How My IPCR works" steps={WORKFLOW_STEPS} />
        <RatingGuide />
      </div>

      {forms.length > 1 ? (
        <FilterPills
          ariaLabel="Choose rating period"
          value={activeForm?.key}
          onChange={(key) => { setSelectedFormKey(key); setStageFilter("all"); }}
          options={forms.map((form) => ({
            value: form.key,
            label: `${periodLabel(form.periodFrom, form.periodTo)} · ${formatRange(form.periodFrom, form.periodTo)}`,
            count: form.kpis.length,
          }))}
        />
      ) : null}

      {!activeForm ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700">
          {loading ? (
            <div className="space-y-3" aria-hidden="true">
              <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
              <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : (
            <HubEmptyState
              icon={ClipboardList}
              title="No IPCR KPIs assigned to you yet."
              description="Your KPIs appear here once they are assigned to you for a rating period."
            />
          )}
        </div>
      ) : (
        <section
          aria-label={`IPCR for ${periodLabel(activeForm.periodFrom, activeForm.periodTo)}`}
          className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800"
        >
          <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={formStatus} fallback="Draft" />
                <MetaChip icon={CalendarDays}>{periodLabel(activeForm.periodFrom, activeForm.periodTo)}</MetaChip>
              </div>
              <h2 className="m-0 mt-2 text-lg font-semibold tracking-tight text-slate-950">
                Individual Performance Commitment · {formatRange(activeForm.periodFrom, activeForm.periodTo)}
              </h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">
                For each KPI, write what you accomplished, rate yourself, and attach your MOVs. Your division chief validates them.
              </p>
            </div>
            <div className="w-full shrink-0 lg:w-72">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold uppercase tracking-wide text-slate-500">KPIs submitted</span>
                <span className="font-bold tabular-nums text-slate-900">{sentCount}/{activeKpis.length}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${sentShare}%` }} />
              </div>
              {finalAverage ? (
                <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">{ratingLabel}</span>
                  <RatingPill value={finalAverage} size="sm" />
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-b border-slate-100 px-4 py-3 sm:px-5 dark:border-slate-800">
            <FilterPills
              ariaLabel="Filter KPIs by stage"
              options={STAGE_FILTERS.map((option) => ({ ...option, count: stageCounts[option.value] }))}
              value={stageFilter}
              onChange={setStageFilter}
            />
          </div>

          {visibleKpis.length === 0 ? (
            <div className="px-4 py-8 sm:px-5">
              <HubEmptyState icon={ListChecks} title="No KPIs match this filter." />
            </div>
          ) : (
            <ol className="m-0 list-none divide-y divide-slate-100 p-0 dark:divide-slate-800">
              {visibleKpis.map((record) => {
                const key = kpiKey(record);
                const position = activeKpis.indexOf(record) + 1;
                const title = text(record.output || record.kpiTitle);
                const stage = kpiStage(record);
                const locked = stage === "validated";
                const changed = isChanged(record);
                const pickedFiles = filesOf(record);
                const savedFiles = record.verificationFiles || [];
                const scores = scoresOf(record);
                const selfAverage = liveAverage(scores);
                const returnNote = text(record.approvalRemarks, "");

                return (
                  <li key={key}>
                    <section
                      id={`my-ipcr-kpi-${key}`}
                      role="group"
                      aria-label={`KPI ${position}: ${title}`}
                      className="scroll-mt-24 px-4 py-4 sm:px-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-bold text-accent-700 dark:bg-accent-950 dark:text-accent-300" aria-hidden="true">
                            {position}
                          </span>
                          <div className="min-w-0">
                            <p className="m-0 text-sm font-semibold leading-snug text-slate-900">{title}</p>
                            {record.program || record.category ? (
                              <p className="m-0 mt-0.5 line-clamp-1 text-[11px] text-slate-500" title={[record.program, record.category].filter(Boolean).join(" · ")}>
                                {[record.program, record.category].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {changed ? (
                            <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              Unsaved
                            </span>
                          ) : null}
                          <StatusBadge status={STAGE_LABELS[stage]} />
                          {locked ? <RatingPill value={averageRating(record)} size="sm" /> : null}
                        </div>
                      </div>

                      {stage === "returned" && returnNote ? (
                        <div role="note" className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-900 dark:bg-rose-950/30">
                          <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                            <Undo2 size={12} aria-hidden="true" />
                            Returned{record.reviewedByName ? ` by ${record.reviewedByName}` : ""} for revision
                          </p>
                          <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{returnNote}</p>
                        </div>
                      ) : null}

                      {locked ? (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
                          <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            <Lock size={12} aria-hidden="true" />
                            Validated{record.reviewedByName ? ` by ${record.reviewedByName}` : ""} · locked
                          </p>
                          <p className="m-0 mt-1 text-[13px] text-slate-700">
                            Final rating: Quantity {ratingNumber(record.q1Rating).toFixed(2)} · Efficiency {ratingNumber(record.e2Rating).toFixed(2)} · Timeliness {ratingNumber(record.t3Rating).toFixed(2)}
                          </p>
                          {text(record.remarks, "") ? (
                            <p className="m-0 mt-1 whitespace-pre-line text-[13px] text-slate-600">Remarks: {record.remarks}</p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div className="min-w-0 space-y-3">
                          <div className={`grid gap-3 ${text(record.secondIndicator, "") ? "sm:grid-cols-2" : ""}`}>
                            <div className="rounded-lg border border-accent-200 bg-accent-50/40 p-3 dark:border-accent-900 dark:bg-accent-950/20">
                              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-400">Success Indicator</p>
                              <div className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700"><SuccessIndicatorList value={record.successIndicator} /></div>
                            </div>
                            {text(record.secondIndicator, "") ? (
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800">
                                <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Success Indicator · second column</p>
                                <div className="m-0 mt-1 text-[13px] leading-relaxed text-slate-700"><SuccessIndicatorList value={record.secondIndicator} /></div>
                              </div>
                            ) : null}
                          </div>

                          {savedFiles.length > 0 ? (
                            <div>
                              <FieldCaption className="mb-1.5">Uploaded MOVs · {savedFiles.length} file{savedFiles.length === 1 ? "" : "s"}</FieldCaption>
                              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                                {savedFiles.map((file) => {
                                  const fileUrl = resolveBackendAssetUrl(file.storedPath || file.path || "");
                                  const isImage = /\bimage\/|\.png|\.jpe?g|\.gif|\.webp/.test(String(file.mimeType || file.originalName || "").toLowerCase());
                                  const name = text(file.originalName || file.name, "Uploaded file");
                                  return (
                                    <li key={file.id || fileUrl} className="flex items-center gap-1 rounded-lg border border-slate-200 transition hover:border-accent-300 dark:border-slate-800">
                                      <a
                                        href={fileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 no-underline"
                                      >
                                        {isImage ? <ImageIcon size={16} className="shrink-0 text-accent-600" /> : <FileText size={16} className="shrink-0 text-accent-600" />}
                                        <span className="min-w-0 flex-1 truncate">{name}</span>
                                        <span className="shrink-0 text-xs font-normal text-slate-500">{fileSizeLabel(file.fileSize)}</span>
                                      </a>
                                      {!locked && file.id ? (
                                        <button
                                          type="button"
                                          onClick={() => removeSavedFile(record, file)}
                                          disabled={saving || removingFileId === file.id}
                                          aria-label={`Remove uploaded ${name}`}
                                          title="Remove"
                                          className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                                        >
                                          <Trash2 size={14} aria-hidden="true" />
                                        </button>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div>
                            <label htmlFor={`my-ipcr-${key}-accomplishment`} className="mb-1.5 block text-sm font-semibold text-slate-700">
                              Actual Accomplishment
                            </label>
                            <textarea
                              id={`my-ipcr-${key}-accomplishment`}
                              value={accomplishmentOf(record)}
                              onChange={(event) => updateDraft(record, { actualAccomplishment: event.target.value })}
                              rows={3}
                              disabled={saving || locked}
                              placeholder="What did you actually accomplish against this KPI?"
                              className={`resize-y ${hubFieldClass}`}
                            />
                          </div>

                          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <FieldCaption>Self-rating</FieldCaption>
                              <span className="text-xs text-slate-500">
                                Average <strong className="tabular-nums text-slate-900">{selfAverage || "N/A"}</strong>
                              </span>
                            </div>
                            <div className="space-y-2.5">
                              {RATING_CRITERIA.map((criterion) => (
                                <div key={criterion.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                  <div className="w-[11rem] shrink-0">
                                    <RatingInput
                                      id={`my-ipcr-${key}-${criterion.name}`}
                                      label={criterion.label}
                                      value={scores[criterion.name] ?? ""}
                                      onValueChange={(value) => updateDraft(record, { [criterion.name]: value })}
                                      disabled={saving || locked}
                                      className="grid grid-cols-[6rem_minmax(0,1fr)] items-center [&>label]:mb-0"
                                      inputClassName="py-1.5 text-sm"
                                    />
                                  </div>
                                  <RatingQuickPick
                                    criterion={criterion.criterion}
                                    value={scores[criterion.name]}
                                    onPick={(value) => updateDraft(record, { [criterion.name]: value })}
                                    disabled={saving || locked}
                                    className=""
                                  />
                                </div>
                              ))}
                            </div>
                          </div>

                          {locked ? null : (
                            <div>
                              <label
                                htmlFor={`my-ipcr-${key}-files`}
                                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-accent-400 hover:bg-accent-50/60 dark:border-slate-700"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <UploadCloud size={16} className="shrink-0 text-accent-600" aria-hidden="true" />
                                  Attach MOVs
                                </span>
                                <span className="shrink-0 text-[11px] font-medium text-slate-400">PDF, Word, Excel, PNG, JPG</span>
                              </label>
                              <input
                                id={`my-ipcr-${key}-files`}
                                type="file"
                                aria-label="Attach MOVs"
                                multiple
                                disabled={saving}
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                                className="sr-only"
                                onChange={(event) => {
                                  addFiles(record, event.target.files);
                                  event.target.value = "";
                                }}
                              />
                              {pickedFiles.length > 0 ? (
                                <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
                                  {pickedFiles.map((file) => (
                                    <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-accent-200 bg-accent-50/40 px-3 py-1.5 text-sm text-slate-700 dark:border-accent-900">
                                      <Paperclip size={14} className="shrink-0 text-accent-600" aria-hidden="true" />
                                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                      <span className="shrink-0 text-xs text-slate-500">{fileSizeLabel(file.size)}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeFile(record, file)}
                                        disabled={saving}
                                        aria-label={`Remove ${file.name}`}
                                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                      >
                                        <X size={14} aria-hidden="true" />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : savedFiles.length === 0 ? (
                                <p className="m-0 mt-1.5 text-xs text-slate-500">At least one MOV is required to submit this KPI.</p>
                              ) : null}
                            </div>
                          )}

                          {changed ? (
                            <button
                              type="button"
                              onClick={() => discardDraft(record)}
                              disabled={saving}
                              className="text-xs font-semibold text-slate-500 underline-offset-2 transition hover:text-slate-800 hover:underline"
                            >
                              Undo changes to this KPI
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  </li>
                );
              })}
            </ol>
          )}

          {/*
            * Sticky, so the submit stays in reach down a long form. The card is deliberately not
            * `overflow-hidden`, which would stop the footer sticking.
            */}
          <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-slate-800">
            <p className="m-0 text-sm text-slate-500">
              {pendingKpis.length === 0
                ? "No unsaved changes."
                : `${pendingKpis.length} KPI${pendingKpis.length === 1 ? "" : "s"} with unsaved changes.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {pendingKpis.length > 0 ? (
                <HubButton variant="outline" onClick={discardAll} disabled={saving}>
                  Discard changes
                </HubButton>
              ) : null}
              <HubButton icon={Send} onClick={handleSubmit} loading={saving} disabled={pendingKpis.length === 0}>
                Submit for validation
              </HubButton>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
