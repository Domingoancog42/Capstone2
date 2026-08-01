import React, { useMemo } from "react";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import { SettingsNotice, SettingsPanel } from "../../components/settings";

/**
 * Panel colours only. Which groups exist is no longer decided here — `buildDeductionGroups` reads
 * them from `deduction_categories`, so adding a category in the database makes a panel appear
 * without a code change. This list used to BE the four groups, one per backing table.
 */
const CATEGORY_BADGE_CLASSES = [
  "bg-sky-50 text-sky-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-700",
  "bg-rose-50 text-rose-700",
  "bg-violet-50 text-violet-700",
  "bg-teal-50 text-teal-700",
  "bg-indigo-50 text-indigo-700",
  "bg-orange-50 text-orange-700",
];

export function buildDeductionGroups(categories = []) {
  return categories
    .filter((category) => category?.categoryCode || category?.code)
    .map((category, index) => ({
      key: category.categoryCode || category.code,
      label: category.categoryName || category.name,
      categoryName: category.categoryName || category.name,
      categoryId: category.categoryId ?? category.id,
      typeCount: category.typeCount ?? 0,
      badgeClassName: CATEGORY_BADGE_CLASSES[index % CATEGORY_BADGE_CLASSES.length],
    }));
}


export const deductionThresholdModeOptions = [
  { value: "fixed", label: "Fixed" },
  { value: "percentage", label: "Percentage" },
  { value: "tiered", label: "Tiered" },
  { value: "bracket", label: "Bracket" },
];

export const defaultDeductionDefinitionForm = {
  type_name: "",
  description: "",
  default_amount: "0.00",
  // A percentage deduction is meaningless without this, and the old four-table shape had no column
  // for it — which is why a GSIS row could sit in percentage mode charging nothing.
  default_rate: "0.0000",
  threshold_amount: "0.00",
  threshold_mode: "fixed",
  threshold_rules: "",
  base_floor: "0.00",
  base_cap: "",
  is_active: "1",
};

function formatDeductionAmount(value) {
  const amount = Number(value || 0);

  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

/**
 * A rate is only meaningful in the modes that charge one, so a fixed deduction shows a dash rather
 * than "0.0000%" — which reads as "charges nothing" instead of "does not use a rate".
 *
 * Trailing zeros are trimmed but the significant digits are not: an attendance rate is 4.54545455%
 * (a day is monthly salary over 22) and rounding it for display would misreport what payroll charges.
 */
function formatDeductionRate(row) {
  const mode = row.threshold_mode || "fixed";

  if (mode === "fixed") {
    return null;
  }

  const rate = Number(row.default_rate || 0);

  if (!Number.isFinite(rate) || rate <= 0) {
    if ((mode === "tiered" || mode === "bracket") && row.threshold_rules) {
      return "Rules";
    }

    return null;
  }

  return `${String(rate).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")}%`;
}

const RATE_MODE_LABEL = {
  percentage: "of salary",
  tiered: "banded",
  bracket: "banded",
};

const baseDeductionColumns = [
  {
    key: "id",
    header: "id",
    headerClassName: "normal-case",
    render: (row) => <span className="font-semibold text-slate-900">{row.id}</span>,
  },
  {
    key: "type_name",
    header: "type_name",
    headerClassName: "normal-case",
    render: (row) => <span className="font-semibold text-slate-900">{row.type_name || "N/A"}</span>,
  },
  {
    key: "description",
    header: "description",
    headerClassName: "normal-case",
    render: (row) => (
      <span className="block max-w-[240px] truncate text-slate-700" title={row.description || ""}>
        {row.description || "N/A"}
      </span>
    ),
  },
  {
    key: "default_amount",
    header: "default_amount",
    headerClassName: "normal-case",
    render: (row) => <span className="tabular-nums text-slate-800">{formatDeductionAmount(row.default_amount)}</span>,
  },
  {
    key: "default_rate",
    header: "rate",
    headerClassName: "normal-case",
    render: (row) => {
      const rate = formatDeductionRate(row);

      if (rate === null) {
        return <span className="text-slate-400">N/A</span>;
      }

      return (
        <span className="whitespace-nowrap">
          <span className="font-semibold tabular-nums text-[#D61E1E]">{rate}</span>
          <span className="ml-1.5 text-xs text-slate-500">{RATE_MODE_LABEL[row.threshold_mode] || ""}</span>
        </span>
      );
    },
  },
  {
    key: "threshold_amount",
    header: "threshold_amount",
    headerClassName: "normal-case",
    render: (row) => <span className="tabular-nums text-slate-800">{formatDeductionAmount(row.threshold_amount)}</span>,
  },
  {
    key: "threshold_mode",
    header: "threshold_mode",
    headerClassName: "normal-case",
    render: (row) => row.threshold_mode || "fixed",
  },
  {
    key: "threshold_rules",
    header: "threshold_rules",
    headerClassName: "normal-case",
    render: (row) => (
      <span className="block max-w-[260px] truncate font-mono text-xs text-slate-700" title={row.threshold_rules || ""}>
        {row.threshold_rules || "N/A"}
      </span>
    ),
  },
  {
    key: "base_floor",
    header: "base_floor",
    headerClassName: "normal-case",
    render: (row) => <span className="tabular-nums text-slate-800">{formatDeductionAmount(row.base_floor)}</span>,
  },
  {
    key: "base_cap",
    header: "base_cap",
    headerClassName: "normal-case",
    render: (row) => (
      row.base_cap === null || row.base_cap === undefined || row.base_cap === ""
        ? "N/A"
        : <span className="tabular-nums text-slate-800">{formatDeductionAmount(row.base_cap)}</span>
    ),
  },
  {
    key: "is_percentage",
    header: "is_percentage",
    headerClassName: "normal-case",
    render: (row) => (
      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
        {Number(row.is_percentage) === 1 ? "1" : "0"}
      </span>
    ),
  },
  {
    key: "is_active",
    header: "is_active",
    headerClassName: "normal-case",
    render: (row) => (
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
          Number(row.is_active ?? 1) === 1
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
      >
        {Number(row.is_active ?? 1) === 1 ? "1" : "0"}
      </span>
    ),
  },
];

/** The Edit action is appended per render because it closes over the handler. */
function buildDeductionColumns(onEdit) {
  if (!onEdit) {
    return baseDeductionColumns;
  }

  return [
    ...baseDeductionColumns,
    {
      key: "actions",
      header: "",
      headerClassName: "normal-case",
      cellClassName: "text-right",
      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
          icon={Pencil}
          onClick={() => onEdit(row)}
          aria-label={`Edit ${row.type_name || "deduction"}`}
        >
          Edit
        </Button>
      ),
    },
  ];
}

export default function DeductionSettings({
  deductionTypes = [],
  categories = [],
  allowances = [],
  loading = false,
  message = "",
  messageTone = "info",
  onAdd,
  onEdit,
  onRefresh,
}) {
  const groups = useMemo(() => buildDeductionGroups(categories), [categories]);
  const columns = useMemo(() => buildDeductionColumns(onEdit), [onEdit]);

  /*
   * Grouping is an exact match on the row's own category now. It used to fall back to matching
   * name prefixes against an alias list ("pagibig", "philhealthpremium", …) because a deduction had
   * no reliable link to its category — the category was a string it happened to carry.
   */
  const deductionTypesByGroup = useMemo(() => {
    return groups.reduce((byGroup, group) => {
      byGroup[group.key] = deductionTypes.filter((deduction) => deduction.groupKey === group.key);
      return byGroup;
    }, {});
  }, [deductionTypes, groups]);

  return (
    <div className="grid gap-4">
      <SettingsNotice tone={messageTone}>{message}</SettingsNotice>

      {!loading && groups.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No deduction categories found.
        </p>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-2">
        {groups.map((group) => {
          const groupDeductions = deductionTypesByGroup[group.key] || [];

          return (
            <SettingsPanel
              key={group.key}
              title={group.label}
              description={`Manage deduction names categorized under ${group.label}.`}
              actions={
                <>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${group.badgeClassName}`}>
                    {groupDeductions.length} item{groupDeductions.length === 1 ? "" : "s"}
                  </span>
                  <Button size="sm" icon={Plus} onClick={() => onAdd?.(group.key)}>
                    Add
                  </Button>
                </>
              }
            >
              <Table
                columns={columns}
                data={groupDeductions}
                rowKey="definitionKey"
                emptyMessage={loading ? "Loading deductions..." : `No ${group.label} deductions found.`}
                tableClassName="min-w-[1800px]"
                className="rounded-lg border border-slate-200"
                stickyHeader
              />
            </SettingsPanel>
          );
        })}
      </div>

      <AllowancePanel allowances={allowances} loading={loading} />

      <div className="flex justify-end">
        <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

const allowanceColumns = [
  {
    key: "allowanceId",
    header: "id",
    headerClassName: "normal-case",
    render: (row) => <span className="font-semibold text-slate-900">{row.allowanceId}</span>,
  },
  {
    key: "allowanceName",
    header: "allowance_name",
    headerClassName: "normal-case",
    render: (row) => <span className="font-semibold text-slate-900">{row.allowanceName || "N/A"}</span>,
  },
  {
    key: "amount",
    header: "amount",
    headerClassName: "normal-case",
    cellClassName: "text-right",
    render: (row) => (
      <span className="tabular-nums font-semibold text-slate-800">{formatDeductionAmount(row.amount)}</span>
    ),
  },
];

/**
 * Allowances sit beside the deductions because together they are the two halves of a payslip, and
 * an administrator checking what a run will pay wants both on one screen.
 */
function AllowancePanel({ allowances = [], loading = false }) {
  const total = allowances.reduce((sum, allowance) => sum + Number(allowance.amount || 0), 0);

  return (
    <SettingsPanel
      title="Allowances"
      description="Allowance types payroll can add to a run, with the amount each carries."
      actions={
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          {allowances.length} item{allowances.length === 1 ? "" : "s"}
        </span>
      }
    >
      <Table
        columns={allowanceColumns}
        data={allowances}
        rowKey="allowanceId"
        emptyMessage={loading ? "Loading allowances..." : "No allowances found."}
        className="rounded-lg border border-slate-200"
      />

      {allowances.length > 0 ? (
        <p className="mt-3 text-right text-sm text-slate-600">
          Total if every allowance applies:{" "}
          <span className="font-semibold tabular-nums text-slate-900">{formatDeductionAmount(total)}</span>
        </p>
      ) : null}
    </SettingsPanel>
  );
}

export function DeductionModal({
  open = false,
  groupKey = "",
  categories = [],
  mode = "add",
  form = defaultDeductionDefinitionForm,
  errors = {},
  saving = false,
  onFieldChange,
  onClose,
  onSubmit,
}) {
  const groupLabel = buildDeductionGroups(categories)
    .find((group) => group.key === groupKey)?.label || "Deduction";
  const isRateBased = form.threshold_mode !== "fixed";
  const isEditing = mode === "edit";

  return (
    <Modal
      open={open}
      title={`${isEditing ? "Edit" : "Add"} ${groupLabel} Deduction`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <InputField
          label="type_name"
          name="type_name"
          value={form.type_name}
          onChange={onFieldChange?.("type_name")}
          placeholder="Enter type name"
          error={errors.type_name}
        />

        <div>
          <label htmlFor="deductionDescription" className="mb-2 block text-sm font-semibold text-slate-700">
            description
          </label>
          <textarea
            id="deductionDescription"
            value={form.description}
            onChange={onFieldChange?.("description")}
            rows={3}
            placeholder="Optional description"
            className="min-h-[96px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <InputField
            label="default_amount"
            name="default_amount"
            type="number"
            min="0"
            step="0.01"
            value={form.default_amount}
            onChange={onFieldChange?.("default_amount")}
          />
          <InputField
            label="threshold_amount"
            name="threshold_amount"
            type="number"
            min="0"
            step="0.01"
            value={form.threshold_amount}
            onChange={onFieldChange?.("threshold_amount")}
          />
          <div>
            <label htmlFor="thresholdMode" className="mb-2 block text-sm font-semibold text-slate-700">
              threshold_mode
            </label>
            <select
              id="thresholdMode"
              value={form.threshold_mode}
              onChange={onFieldChange?.("threshold_mode")}
              className="min-h-[46px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-slate-900 outline-none focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
            >
              {deductionThresholdModeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <InputField
            label="default_rate (%)"
            name="default_rate"
            type="number"
            min="0"
            max="100"
            step="0.0001"
            value={form.default_rate}
            onChange={onFieldChange?.("default_rate")}
            error={errors.default_rate}
            disabled={!isRateBased}
            placeholder={isRateBased ? "e.g. 9 for 9%" : "Rate modes only"}
          />
          <InputField
            label="base_floor"
            name="base_floor"
            type="number"
            min="0"
            step="0.01"
            value={form.base_floor}
            onChange={onFieldChange?.("base_floor")}
          />
          <InputField
            label="base_cap"
            name="base_cap"
            type="number"
            min="0"
            step="0.01"
            value={form.base_cap}
            onChange={onFieldChange?.("base_cap")}
            placeholder="Optional"
          />
        </div>

        <p className="-mt-2 text-xs text-slate-500">
          {isRateBased
            ? "The rate applies with the selected mode, using threshold rules and base limits when present."
            : "Fixed deductions charge default_amount. Switch threshold_mode to Percentage, Tiered, or Bracket to set a rate."}
        </p>

        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEditing ? "Update Deduction" : "Save Deduction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
