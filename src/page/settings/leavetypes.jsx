import React, { useMemo } from "react";
import { FileText, Plus, Search } from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import { SettingsPanel } from "../../components/settings";

const leaveTypeColumns = [
  {
    key: "name",
    header: "Leave Type",
    cardRole: "title",
    render: (row) => (
      <div>
        <p className="m-0 font-semibold text-slate-900">{row.name}</p>
        {row.description ? (
          <p className="m-0 mt-1 max-w-[320px] truncate text-xs text-slate-500">{row.description}</p>
        ) : null}
      </div>
    ),
  },
  {
    key: "code",
    header: "Code",
    render: (row) => (
      <span className="inline-flex min-h-7 items-center rounded-full bg-slate-100 px-2.5 font-mono text-xs font-semibold text-slate-700">
        {row.code || "N/A"}
      </span>
    ),
  },
  {
    key: "maxDaysPerYear",
    header: "Max Days/Year",
    render: (row) => {
      const value = Number(row.maxDaysPerYear);
      return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "No yearly cap";
    },
  },
  {
    key: "isWithPay",
    header: "With Pay",
    render: (row) => (Number(row.isWithPay) === 1 ? "Yes" : "No"),
  },
  {
    key: "requiresAttachment",
    header: "Attachment",
    render: (row) => (Number(row.requiresAttachment) === 1 ? "Required" : "Not required"),
  },
  {
    key: "isActive",
    header: "Status",
    cardRole: "badge",
    render: (row) => (
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
          Number(row.isActive) === 1
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
      >
        {Number(row.isActive) === 1 ? "Active" : "Inactive"}
      </span>
    ),
  },
];

export default function LeaveTypeSettings({
  leaveTypes = [],
  query = "",
  onQueryChange,
  onAdd,
}) {
  const filteredLeaveTypes = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return leaveTypes;
    }

    return leaveTypes.filter((leaveType) =>
      [leaveType.name, leaveType.code, leaveType.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [query, leaveTypes]);

  return (
    <SettingsPanel
      icon={FileText}
      title="Leave Types"
      description="Maintain the leave types available for employee leave requests."
      actions={
        <>
          <InputField
            name="leaveTypeSearch"
            value={query}
            onChange={onQueryChange}
            placeholder="Search leave types"
            icon={Search}
            aria-label="Search leave types"
            className="w-full sm:w-[260px]"
          />
          <Button icon={Plus} onClick={onAdd}>
            Add Leave Type
          </Button>
        </>
      }
    >
      <Table
        columns={leaveTypeColumns}
        data={filteredLeaveTypes}
        rowKey="id"
        emptyMessage="No leave types found."
        tableClassName="min-w-[1120px]"
        className="rounded-lg border border-slate-200"
        cardsClassName="lg:hidden"
        tableWrapperClassName="hidden lg:block"
      />
    </SettingsPanel>
  );
}

export function LeaveTypeModal({
  open = false,
  name = "",
  code = "",
  errors = {},
  saving = false,
  onNameChange,
  onCodeChange,
  onClose,
  onSubmit,
}) {
  return (
    <Modal open={open} title="Add Leave Type" onClose={onClose}>
      <form className="grid gap-5" onSubmit={onSubmit}>
        <InputField
          label="Leave Type Name"
          name="leaveTypeName"
          value={name}
          onChange={onNameChange}
          placeholder="Enter leave type name"
          error={errors.leaveTypeName}
        />
        <InputField
          label="Code"
          name="leaveTypeCode"
          value={code}
          onChange={onCodeChange}
          placeholder="Auto-generated if blank"
          error={errors.leaveTypeCode}
        />
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save Leave Type
          </Button>
        </div>
      </form>
    </Modal>
  );
}
