import React, { useEffect, useMemo, useState } from "react";
import { PenLine, Save } from "lucide-react";
import Button from "../../components/UI/button";
import Card, {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/UI/card";

/*
 * Who signs a payroll register.
 *
 * The four names used to be written into the payroll workspace and the Excel exporter. They are
 * people, so they are picked here instead and read back from the chosen employee's own record --
 * which is what keeps the screen, the print-out and the workbook naming the same officers.
 *
 * The office titles beside each picker are not editable: they name the signature the printed form
 * requires, not the person's own designation.
 */
function SignatorySlot({ slot, employees, value, onChange }) {
  const selected = employees.find((employee) => String(employee.employeeRecordId) === String(value));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {slot.box ? (
              <span className="grid h-6 w-6 place-items-center rounded border border-slate-300 bg-slate-50 text-xs font-extrabold text-slate-700">
                {slot.box}
              </span>
            ) : null}
            <p className="m-0 truncate text-sm font-extrabold text-slate-900">{slot.title}</p>
          </div>
          <p className="m-0 mt-1 text-xs text-slate-500">{slot.description}</p>
        </div>

        {slot.isFallback && !slot.isConfigured ? (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
            Filled in from role
          </span>
        ) : null}
        {!slot.isConfigured && !slot.isFallback ? (
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">
            Blank on the form
          </span>
        ) : null}
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Signatory</span>
        <select
          value={value || ""}
          onChange={(event) => onChange(slot.key, event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
        >
          <option value="">Leave blank</option>
          {employees.map((employee) => (
            <option key={employee.employeeRecordId} value={employee.employeeRecordId}>
              {employee.name}
              {employee.position || employee.designation ? ` - ${[employee.position, employee.designation].filter(Boolean).join(" · ")}` : ""}
            </option>
          ))}
        </select>
      </label>

      <p className="m-0 mt-2 text-xs text-slate-500">
        Prints as{" "}
        <span className="font-bold uppercase text-slate-800">
          {selected ? selected.name : slot.name || "a blank signature line"}
        </span>
        {selected?.division ? ` (${selected.division})` : ""}
      </p>
    </div>
  );
}

export default function PayrollSignatorySettings({
  slots = [],
  employees = [],
  saving = false,
  notice = "",
  noticeTone = "info",
  onSave,
}) {
  const [selection, setSelection] = useState({});

  // Re-seed whenever the server sends a fresh set, so a save elsewhere is reflected here.
  useEffect(() => {
    setSelection(
      slots.reduce((current, slot) => {
        // Only a deliberate pick is pre-selected; a role fallback stays an empty dropdown so the
        // difference between "chosen" and "guessed" is visible.
        current[slot.key] = slot.isConfigured && slot.employeeRecordId ? String(slot.employeeRecordId) : "";
        return current;
      }, {})
    );
  }, [slots]);

  const dirty = useMemo(
    () =>
      slots.some((slot) => {
        const original = slot.isConfigured && slot.employeeRecordId ? String(slot.employeeRecordId) : "";
        return (selection[slot.key] || "") !== original;
      }),
    [selection, slots]
  );

  const handleChange = (key, value) => {
    setSelection((current) => ({ ...current, [key]: value }));
  };

  const handleSave = () => {
    onSave?.(
      slots.reduce((payload, slot) => {
        payload[slot.key] = Number(selection[slot.key]) || 0;
        return payload;
      }, {})
    );
  };

  const noticeClass =
    noticeTone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : noticeTone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <Card className="border-slate-200/80 bg-white/95 shadow-sm">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <PenLine size={18} className="text-slate-500" />
            Payroll Signatories
          </CardTitle>
          <CardDescription>
            The officers who certify, approve and pay a payroll register. Their names are read from
            the employee records you choose here and appear on the payroll view and its Excel export.
          </CardDescription>
        </div>
        <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={handleSave}>
          Save Signatories
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {notice ? (
          <p className={`m-0 rounded-lg border px-3 py-2 text-sm font-semibold ${noticeClass}`}>{notice}</p>
        ) : null}

        {slots.length === 0 ? (
          <p className="m-0 rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-500">
            Payroll signatory slots are unavailable.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {slots.map((slot) => (
              <SignatorySlot
                key={slot.key}
                slot={slot}
                employees={employees}
                value={selection[slot.key] || ""}
                onChange={handleChange}
              />
            ))}
          </div>
        )}

        <p className="m-0 text-xs text-slate-500">
          A slot left blank prints an empty signature line rather than a name, which is the honest
          result when an office is vacant.
        </p>
      </CardContent>
    </Card>
  );
}
