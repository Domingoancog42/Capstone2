import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CircleAlert,
  Mail,
  Pencil,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import Modal from "../../components/UI/modal";
import Button from "../../components/UI/button";
import {
  deleteReportSchedule,
  getReportSchedules,
  saveReportSchedule,
} from "../../services/api";
import { DATE_RANGE_OPTIONS } from "./reportsTheme";

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

const FORMATS = [
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "csv", label: "CSV" },
];

const EMPTY_FORM = {
  id: null,
  name: "",
  reportType: "",
  frequency: "monthly",
  exportFormat: "pdf",
  dateRange: "lastMonth",
  recipients: "",
  isActive: true,
};

function Field({ label, htmlFor, children, hint }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const inputClasses =
  "min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400";

export default function ScheduledReportsPanel({ catalog = [], onNotify }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");

  const reportOptions = useMemo(
    () =>
      catalog.flatMap((category) =>
        category.reports
          .filter((report) => report.available)
          .map((report) => ({ value: report.key, label: report.label, group: category.label }))
      ),
    [catalog]
  );

  useEffect(() => {
    let active = true;

    getReportSchedules()
      .then((payload) => {
        if (active) {
          setSchedules(payload.schedules || []);
        }
      })
      .catch(() => {
        if (active) {
          setSchedules([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, reportType: reportOptions[0]?.value || "" });
    setError("");
    setModalOpen(true);
  };

  const openEdit = (schedule) => {
    setForm({
      id: schedule.id,
      name: schedule.name,
      reportType: schedule.reportType,
      frequency: schedule.frequency,
      exportFormat: schedule.exportFormat,
      dateRange: schedule.dateRange,
      recipients: (schedule.recipients || []).join(", "),
      isActive: schedule.isActive,
    });
    setError("");
    setModalOpen(true);
  };

  const persist = async (payload, successMessage) => {
    setSaving(true);
    setError("");

    try {
      const response = await saveReportSchedule(payload);
      setSchedules(response.schedules || []);
      setModalOpen(false);
      onNotify?.(successMessage, "success");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save the scheduled report.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    persist(
      {
        ...form,
        recipients: form.recipients
          .split(",")
          .map((email) => email.trim())
          .filter(Boolean),
      },
      form.id ? "Scheduled report updated." : "Scheduled report created."
    );
  };

  const handleToggleActive = (schedule) => {
    persist(
      {
        ...schedule,
        isActive: !schedule.isActive,
      },
      schedule.isActive ? "Schedule paused." : "Schedule activated."
    );
  };

  const handleDelete = async (schedule) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete the scheduled report "${schedule.name}"?`)) {
      return;
    }

    try {
      const response = await deleteReportSchedule(schedule.id);
      setSchedules(response.schedules || []);
      onNotify?.("Scheduled report deleted.", "success");
    } catch (requestError) {
      onNotify?.(requestError.response?.data?.message || "Unable to delete the schedule.", "error");
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-900">Scheduled Reports</h2>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Recurring report definitions with their delivery recipients and next run date.
          </p>
        </div>
        <Button icon={Plus} size="sm" onClick={openCreate} disabled={reportOptions.length === 0}>
          New Schedule
        </Button>
      </header>

      <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-5">
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="m-0 text-xs leading-relaxed text-amber-900">
          Schedules are stored and shown here, but nothing dispatches them yet. To start automatic delivery, register a
          recurring task that requests the report export endpoint — see the deployment note in the module README.
        </p>
      </div>

      <div className="p-4 sm:p-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`schedule-skeleton-${index}`} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-4 py-12 text-center">
            <div>
              <CalendarDays size={28} className="mx-auto mb-2 text-slate-300" aria-hidden="true" />
              <p className="m-0 text-sm font-semibold text-slate-700">No scheduled reports yet</p>
              <p className="m-0 mt-1 text-sm text-slate-500">
                Create a schedule to keep a recurring report definition on file.
              </p>
            </div>
          </div>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3.5 transition hover:border-slate-300 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 truncate text-sm font-semibold text-slate-900">{schedule.name}</p>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        schedule.isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {schedule.isActive ? "Active" : "Paused"}
                    </span>
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-600">
                      {schedule.exportFormat}
                    </span>
                  </div>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    {`${schedule.reportLabel} · ${FREQUENCIES.find((item) => item.value === schedule.frequency)?.label || schedule.frequency}`}
                    {schedule.nextRunAt ? ` · Next run ${schedule.nextRunAt}` : ""}
                  </p>
                  {schedule.recipients.length > 0 ? (
                    <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Mail size={12} aria-hidden="true" />
                      {schedule.recipients.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(schedule)}
                    title={schedule.isActive ? "Pause schedule" : "Activate schedule"}
                    aria-label={schedule.isActive ? "Pause schedule" : "Activate schedule"}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                  >
                    <Power size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(schedule)}
                    title="Edit schedule"
                    aria-label="Edit schedule"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(schedule)}
                    title="Delete schedule"
                    aria-label="Delete schedule"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={form.id ? "Edit Scheduled Report" : "New Scheduled Report"}
        maxWidth="max-w-[620px]"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="report-schedule-form" loading={saving}>
              {form.id ? "Save Changes" : "Create Schedule"}
            </Button>
          </>
        )}
      >
        <form id="report-schedule-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          {error ? (
            <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 sm:col-span-2">
              {error}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <Field label="Schedule Name" htmlFor="schedule-name">
              <input
                id="schedule-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
                maxLength={150}
                placeholder="e.g. Monthly Payroll Register"
                className={inputClasses}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Report" htmlFor="schedule-report">
              <select
                id="schedule-report"
                value={form.reportType}
                onChange={(event) => setForm((current) => ({ ...current, reportType: event.target.value }))}
                required
                className={inputClasses}
              >
                {reportOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {`${option.group} — ${option.label}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Frequency" htmlFor="schedule-frequency">
            <select
              id="schedule-frequency"
              value={form.frequency}
              onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
              className={inputClasses}
            >
              {FREQUENCIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Export Format" htmlFor="schedule-format">
            <select
              id="schedule-format"
              value={form.exportFormat}
              onChange={(event) => setForm((current) => ({ ...current, exportFormat: event.target.value }))}
              className={inputClasses}
            >
              {FORMATS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Reporting Period" htmlFor="schedule-range">
              <select
                id="schedule-range"
                value={form.dateRange}
                onChange={(event) => setForm((current) => ({ ...current, dateRange: event.target.value }))}
                className={inputClasses}
              >
                {DATE_RANGE_OPTIONS.filter((option) => option.value !== "custom").map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="Email Recipients"
              htmlFor="schedule-recipients"
              hint="Comma-separated addresses. Invalid entries are dropped when saving."
            >
              <input
                id="schedule-recipients"
                value={form.recipients}
                onChange={(event) => setForm((current) => ({ ...current, recipients: event.target.value }))}
                placeholder="hr@example.gov.ph, director@example.gov.ph"
                className={inputClasses}
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-slate-900"
            />
            Schedule is active
          </label>
        </form>
      </Modal>
    </section>
  );
}
