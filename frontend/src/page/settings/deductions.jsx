import React, { useMemo, useState } from "react";
import { ChevronDown, Eye, Pencil, Plus, Power, RefreshCw, Search } from "lucide-react";
import Button from "../../components/UI/button";
import InputField from "../../components/UI/InputField";
import Modal from "../../components/UI/modal";
import Table from "../../components/UI/table";
import { SettingsNotice, SettingsPanel } from "../../components/settings";

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
  { value: "tiered", label: "Rule Based" },
  { value: "bracket", label: "Bracket" },
];

export const defaultDeductionDefinitionForm = {
  type_name: "",
  description: "",
  default_amount: "0.00",
  default_rate: "0.0000",
  threshold_amount: "0.00",
  threshold_mode: "fixed",
  threshold_rules: "",
  base_floor: "0.00",
  base_cap: "",
  is_active: "1",
};

function numericValue(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatDeductionAmount(value) {
  return numericValue(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDeductionRateValue(value) {
  const rate = numericValue(value);

  if (rate <= 0) {
    return "";
  }

  return `${String(rate).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")}%`;
}

export function getDeductionComputation(row = {}) {
  const mode = String(row.threshold_mode || "fixed").toLowerCase();

  if (mode === "bracket") {
    return "Bracket";
  }

  if (mode === "tiered" || row.threshold_rules) {
    return "Rule Based";
  }

  if (mode === "percentage" || Number(row.is_percentage) === 1) {
    return "Percentage";
  }

  return "Fixed";
}

export function getDeductionAmountDisplay(row = {}) {
  const computation = getDeductionComputation(row);

  if (computation === "Percentage") {
    return formatDeductionRateValue(row.default_rate) || "Automatic";
  }

  if (computation === "Rule Based" || computation === "Bracket") {
    return "Automatic";
  }

  const amount = numericValue(row.default_amount);
  return amount > 0 ? `₱${formatDeductionAmount(amount)}` : "Employee Specific";
}

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function buildDeductionColumns({ onView, onEdit, onToggleStatus, togglingDeductionId }) {
  return [
    {
      key: "type_name",
      header: "Deduction Name",
      headerClassName: "w-[17%]",
      cardRole: "title",
      render: (row) => (
        <span className="font-semibold text-slate-900">{row.type_name || "Unnamed deduction"}</span>
      ),
    },
    {
      key: "description",
      header: "Description",
      headerClassName: "w-[23%]",
      cardRole: "subtitle",
      render: (row) => (
        <span className="block break-words text-sm leading-5 text-slate-600">
          {row.description || "No description provided."}
        </span>
      ),
    },
    {
      key: "computation",
      header: "Computation",
      headerClassName: "w-[13%]",
      render: (row) => <span className="font-medium text-slate-700">{getDeductionComputation(row)}</span>,
    },
    {
      key: "amountRate",
      header: "Amount / Rate",
      headerClassName: "w-[15%]",
      render: (row) => {
        const display = getDeductionAmountDisplay(row);
        const employeeSpecific = display === "Employee Specific";

        return (
          <span className={`font-semibold tabular-nums ${employeeSpecific ? "text-slate-600" : "text-slate-900"}`}>
            {display}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      headerClassName: "w-[10%]",
      cardRole: "badge",
      render: (row) => <StatusBadge active={Number(row.is_active ?? 1) === 1} />,
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "w-[22%]",
      cardRole: "actions",
      render: (row) => {
        const active = Number(row.is_active ?? 1) === 1;

        return (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" icon={Eye} onClick={() => onView?.(row)}>
              View
            </Button>
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => onEdit?.(row)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Power}
              loading={togglingDeductionId === row.id}
              onClick={() => onToggleStatus?.(row)}
              className={active ? "text-rose-700" : "text-emerald-700"}
              aria-label={`${active ? "Deactivate" : "Activate"} ${row.type_name || "deduction"}`}
            >
              {active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        );
      },
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
  togglingDeductionId = null,
  onAdd,
  onEdit,
  onToggleStatus,
  onRefresh,
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewingDeduction, setViewingDeduction] = useState(null);
  const groups = useMemo(() => buildDeductionGroups(categories), [categories]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtersActive = normalizedQuery !== "" || statusFilter !== "all";

  const filteredDeductions = useMemo(() => {
    return deductionTypes.filter((deduction) => {
      const active = Number(deduction.is_active ?? 1) === 1;
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "active" && active)
        || (statusFilter === "inactive" && !active);
      const matchesQuery = !normalizedQuery || [
        deduction.type_name,
        deduction.description,
        deduction.groupLabel,
        getDeductionComputation(deduction),
        getDeductionAmountDisplay(deduction),
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));

      return matchesStatus && matchesQuery;
    });
  }, [deductionTypes, normalizedQuery, statusFilter]);

  const deductionTypesByGroup = useMemo(() => {
    return groups.reduce((byGroup, group) => {
      byGroup[group.key] = filteredDeductions.filter((deduction) => deduction.groupKey === group.key);
      return byGroup;
    }, {});
  }, [filteredDeductions, groups]);

  const columns = useMemo(() => buildDeductionColumns({
    onView: setViewingDeduction,
    onEdit,
    onToggleStatus,
    togglingDeductionId,
  }), [onEdit, onToggleStatus, togglingDeductionId]);

  return (
    <div className="grid gap-4">
      <SettingsNotice tone={messageTone}>{message}</SettingsNotice>

      <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.65)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <InputField
            name="deductionSearch"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search deductions..."
            icon={Search}
            aria-label="Search deductions"
            className="lg:flex-1"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="deductionStatusFilter" className="sr-only">Filter deductions by status</label>
            <select
              id="deductionStatusFilter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 outline-none focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
            >
              <option value="all">Status: All</option>
              <option value="active">Status: Active</option>
              <option value="inactive">Status: Inactive</option>
            </select>
            <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </div>
        <p className="m-0 mt-3 text-xs text-slate-500" aria-live="polite">
          Showing {filteredDeductions.length} of {deductionTypes.length} deductions
        </p>
      </div>

      {!loading && groups.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
          No deduction categories found.
        </p>
      ) : null}

      <div className="grid gap-4">
        {groups.map((group) => {
          const groupDeductions = deductionTypesByGroup[group.key] || [];
          const totalInGroup = deductionTypes.filter((deduction) => deduction.groupKey === group.key).length;

          return (
            <SettingsPanel
              key={group.key}
              title={group.label}
              description={`Manage ${group.label} deduction settings.`}
              actions={
                <>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${group.badgeClassName}`}>
                    {filtersActive ? `${groupDeductions.length} of ${totalInGroup}` : groupDeductions.length} item{totalInGroup === 1 ? "" : "s"}
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
                emptyMessage={loading
                  ? "Loading deductions..."
                  : filtersActive
                    ? `No ${group.label} deductions match the current filters.`
                    : `No ${group.label} deductions found.`}
                loading={loading}
                tableClassName="table-fixed"
                minWidthClassName="min-w-[900px]"
                className="rounded-lg border border-slate-200"
                cardsClassName="xl:hidden"
                tableWrapperClassName="hidden xl:block"
                stickyHeader
              />
            </SettingsPanel>
          );
        })}
      </div>

      <AllowancePanel allowances={allowances} loading={loading} />

      <DeductionViewModal
        deduction={viewingDeduction}
        onClose={() => setViewingDeduction(null)}
        onEdit={(deduction) => {
          setViewingDeduction(null);
          onEdit?.(deduction);
        }}
      />
    </div>
  );
}

const allowanceColumns = [
  {
    key: "allowanceName",
    header: "Allowance Name",
    cardRole: "title",
    render: (row) => <span className="font-semibold text-slate-900">{row.allowanceName || "N/A"}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    cellClassName: "text-right",
    render: (row) => <span className="tabular-nums font-semibold text-slate-800">₱{formatDeductionAmount(row.amount)}</span>,
  },
];

function AllowancePanel({ allowances = [], loading = false }) {
  const total = allowances.reduce((sum, allowance) => sum + numericValue(allowance.amount), 0);

  return (
    <SettingsPanel
      title="Allowance Reference"
      description="Existing allowance types shown here for payroll setup reference."
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
        loading={loading}
        emptyMessage={loading ? "Loading allowances..." : "No allowances found."}
        minWidthClassName="min-w-0"
        className="rounded-lg border border-slate-200"
      />

      {allowances.length > 0 ? (
        <p className="mt-3 text-right text-sm text-slate-600">
          Total if every allowance applies:{" "}
          <span className="font-semibold tabular-nums text-slate-900">₱{formatDeductionAmount(total)}</span>
        </p>
      ) : null}
    </SettingsPanel>
  );
}

function DetailItem({ label, value, full = false }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</dt>
      <dd className="m-0 mt-1 break-words text-sm font-medium text-slate-800">{value || "Not set"}</dd>
    </div>
  );
}

function DeductionViewModal({ deduction, onClose, onEdit }) {
  if (!deduction) {
    return null;
  }

  const active = Number(deduction.is_active ?? 1) === 1;
  const rate = formatDeductionRateValue(deduction.default_rate);

  return (
    <Modal open title={deduction.type_name || "Deduction details"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-slate-400">{deduction.groupLabel}</p>
            <p className="m-0 mt-1 text-sm text-slate-600">{deduction.description || "No description provided."}</p>
          </div>
          <StatusBadge active={active} />
        </div>

        <dl className="m-0 grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
          <DetailItem label="Computation" value={getDeductionComputation(deduction)} />
          <DetailItem label="Amount / Rate" value={getDeductionAmountDisplay(deduction)} />
          <DetailItem label="Default Amount" value={`₱${formatDeductionAmount(deduction.default_amount)}`} />
          <DetailItem label="Rate" value={rate || "Not used"} />
        </dl>

        <details className="group rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800">
            Advanced Computation Settings
            <ChevronDown size={17} className="transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl className="m-0 grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
            <DetailItem label="Threshold Amount" value={`₱${formatDeductionAmount(deduction.threshold_amount)}`} />
            <DetailItem label="Threshold Mode" value={deduction.threshold_mode || "fixed"} />
            <DetailItem label="Base Floor" value={`₱${formatDeductionAmount(deduction.base_floor)}`} />
            <DetailItem
              label="Base Cap"
              value={deduction.base_cap === null || deduction.base_cap === ""
                ? "No cap"
                : `₱${formatDeductionAmount(deduction.base_cap)}`}
            />
            <DetailItem label="Threshold Rules" value={deduction.threshold_rules || "No rules configured"} full />
          </dl>
        </details>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button icon={Pencil} onClick={() => onEdit?.(deduction)}>Edit Deduction</Button>
        </div>
      </div>
    </Modal>
  );
}

function FormToggle({ id, label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div>
        <label htmlFor={id} className="block text-sm font-semibold text-slate-800">{label}</label>
        {description ? <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/30 ${
          checked ? "bg-[#D61E1E]" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function AffixedNumberField({ id, label, prefix = "", suffix = "", error, ...props }) {
  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</label>
      <div className={`flex min-h-10 items-center rounded-lg border bg-white ${error ? "border-rose-600" : "border-slate-200"}`}>
        {prefix ? <span className="border-r border-slate-200 px-3 text-sm font-semibold text-slate-500">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        {suffix ? <span className="border-l border-slate-200 px-3 text-sm font-semibold text-slate-500">{suffix}</span> : null}
      </div>
      {error ? <p id={`${id}-error`} className="mt-1.5 text-sm text-rose-700">{error}</p> : null}
    </div>
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
  const computationMode = form.threshold_mode || "fixed";
  const isPercentage = computationMode === "percentage";
  const isRuleBased = computationMode === "tiered" || computationMode === "bracket";
  const isEditing = mode === "edit";
  const active = String(form.is_active ?? "1") === "1";
  const changeValue = (field, value) => onFieldChange?.(field)({ target: { value } });

  return (
    <Modal
      open={open}
      title={`${isEditing ? "Edit" : "Add"} ${groupLabel} Deduction`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <section>
          <div className="mb-3">
            <h3 className="m-0 text-sm font-bold text-slate-900">Basic Information</h3>
            <p className="m-0 mt-1 text-xs text-slate-500">Name the deduction and explain when it applies.</p>
          </div>
          <div className="grid gap-4 rounded-xl border border-slate-200 p-4">
            <InputField
              label="Deduction Name"
              name="type_name"
              value={form.type_name}
              onChange={onFieldChange?.("type_name")}
              placeholder="Enter deduction name"
              error={errors.type_name}
            />

            <div>
              <label htmlFor="deductionDescription" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Description
              </label>
              <textarea
                id="deductionDescription"
                value={form.description}
                onChange={onFieldChange?.("description")}
                rows={3}
                placeholder="Describe when this deduction is applied"
                className="min-h-[96px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
              />
            </div>

            <FormToggle
              id="deductionActive"
              label="Active"
              description="Inactive deductions remain available for reference but are not enabled for payroll use."
              checked={active}
              onChange={(checked) => changeValue("is_active", checked ? "1" : "0")}
            />
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h3 className="m-0 text-sm font-bold text-slate-900">Amount / Rate</h3>
            <p className="m-0 mt-1 text-xs text-slate-500">Use the deduction's existing amount and rate settings.</p>
          </div>
          <div className="grid gap-4 rounded-xl border border-slate-200 p-4">
            <FormToggle
              id="percentageDeduction"
              label="Percentage Deduction"
              description="Turn on to calculate this deduction as a percentage instead of a fixed amount."
              checked={isPercentage}
              onChange={(checked) => changeValue("threshold_mode", checked ? "percentage" : "fixed")}
            />

            {computationMode === "fixed" ? (
              <div>
                <AffixedNumberField
                  id="deductionDefaultAmount"
                  label="Default Amount"
                  prefix="₱"
                  min="0"
                  step="0.01"
                  value={form.default_amount}
                  onChange={onFieldChange?.("default_amount")}
                />
                <p className="m-0 mt-2 text-xs leading-5 text-slate-500">
                  Leave this at ₱0.00 when the amount is entered per employee. It will display as Employee Specific.
                </p>
              </div>
            ) : (
              <div>
                <AffixedNumberField
                  id="deductionDefaultRate"
                  label={isRuleBased ? "Default Rate (optional)" : "Rate"}
                  suffix="%"
                  min="0"
                  max="100"
                  step="0.0001"
                  value={form.default_rate}
                  onChange={onFieldChange?.("default_rate")}
                  error={errors.default_rate}
                  placeholder={isRuleBased ? "Optional base rate" : "e.g. 9.00"}
                />
                <p className="m-0 mt-2 text-xs leading-5 text-slate-500">
                  {isRuleBased
                    ? "The configured threshold rules determine the final deduction automatically."
                    : "Enter the percentage rate payroll should apply."}
                </p>
              </div>
            )}
          </div>
        </section>

        <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-slate-800">
            <span>
              Advanced Computation Settings
              <span className="mt-0.5 block text-xs font-normal text-slate-500">Existing threshold and salary-base controls</span>
            </span>
            <ChevronDown size={18} className="transition group-open:rotate-180" aria-hidden="true" />
          </summary>

          <div className="grid gap-4 border-t border-slate-200 bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="thresholdMode" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Threshold Mode
                </label>
                <select
                  id="thresholdMode"
                  value={form.threshold_mode}
                  onChange={onFieldChange?.("threshold_mode")}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
                >
                  {deductionThresholdModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <AffixedNumberField
                id="deductionThresholdAmount"
                label="Threshold Amount"
                prefix="₱"
                min="0"
                step="0.01"
                value={form.threshold_amount}
                onChange={onFieldChange?.("threshold_amount")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AffixedNumberField
                id="deductionBaseFloor"
                label="Base Floor"
                prefix="₱"
                min="0"
                step="0.01"
                value={form.base_floor}
                onChange={onFieldChange?.("base_floor")}
              />
              <AffixedNumberField
                id="deductionBaseCap"
                label="Base Cap"
                prefix="₱"
                min="0"
                step="0.01"
                value={form.base_cap}
                onChange={onFieldChange?.("base_cap")}
                placeholder="No cap"
              />
            </div>

            <div>
              <label htmlFor="deductionThresholdRules" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Threshold Rules
              </label>
              <textarea
                id="deductionThresholdRules"
                value={form.threshold_rules}
                onChange={onFieldChange?.("threshold_rules")}
                rows={5}
                placeholder="Existing JSON rule configuration"
                className="min-h-[112px] w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 font-mono text-xs text-slate-900 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-[#D61E1E] focus:ring-2 focus:ring-[#D61E1E]/15"
              />
              <p className="m-0 mt-2 text-xs text-slate-500">Keep the existing JSON format used by payroll calculations.</p>
            </div>
          </div>
        </details>

        <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
          <Button type="submit" loading={saving}>
            {isEditing ? "Update Deduction" : "Save Deduction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
