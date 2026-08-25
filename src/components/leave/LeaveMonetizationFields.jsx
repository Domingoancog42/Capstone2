import React, { useEffect, useMemo, useState } from "react";
import { Coins } from "lucide-react";
import { fetchMonetizableLeaveCredits } from "../../services/leaveMonetizationService";
import { currencyFormatter } from "../../utils/format";
import {
  formatMonetizationDays,
  resolveMonetizationRules,
} from "../../utils/leaveMonetization";

const fieldClassName =
  "min-h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-100";

/**
 * The monetization half of the leave request form — the credit to draw from, how many days of it,
 * and what the payout comes to.
 *
 * It owns the credit summary because that is the only thing on the form that has to be fetched:
 * the balances, the daily rate and the CSC ceilings all come from leave_monetization.php, keyed to
 * whoever the filing is for. The summary is handed back up through `onSummaryChange` so the modal
 * can validate the entered figure against the same numbers before it submits.
 */
export default function LeaveMonetizationFields({
  employeeRecordId = "",
  creditCode = "",
  numberOfDays = "",
  dateFiled = "",
  daysError = "",
  needsJustification = false,
  errors = {},
  onChange,
  onSummaryChange,
}) {
  const [creditSummary, setCreditSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;

    const loadCredits = async () => {
      setLoading(true);
      setLoadError("");

      try {
        const result = await fetchMonetizableLeaveCredits(employeeRecordId || null);

        if (!active) {
          return;
        }

        setCreditSummary(result || null);
        onSummaryChange?.(result || null);
      } catch (error) {
        if (!active) {
          return;
        }

        setCreditSummary(null);
        onSummaryChange?.(null);
        setLoadError(
          error?.response?.data?.message || "Unable to load monetizable leave credits."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadCredits();

    return () => {
      active = false;
    };
    /* `onSummaryChange` is a stable callback from the modal; refetching is keyed to the employee. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeRecordId]);

  const creditOptions = useMemo(
    () => (Array.isArray(creditSummary?.options) ? creditSummary.options : []),
    [creditSummary]
  );
  const rules = useMemo(() => resolveMonetizationRules(creditSummary), [creditSummary]);
  const selectedOption = creditOptions.find((option) => option.code === creditCode) || null;
  const requestedDays = Number(numberOfDays || 0);
  const dailyRate = Number(creditSummary?.dailyRate || 0);
  const estimatedAmount = requestedDays > 0 ? dailyRate * requestedDays : 0;
  const yearToDateMonetized = Number(creditSummary?.yearToDateMonetized || 0);
  const annualRemaining = Math.max(0, rules.annualCapDays - yearToDateMonetized);
  const accumulatedDays = Number(selectedOption?.remaining || 0);

  return (
    <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="m-0 text-sm font-semibold text-slate-800">Monetization of Leave Credits</p>
      <p className="m-0 mt-1 text-xs text-slate-500">
        Convert unused leave credits to cash. The HR Head reviews the filing and the Regional
        Director gives the final approval, the same chain a leave request follows.
      </p>

      <div className="mt-3">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">
          Leave credit to monetize
        </span>
        {loading ? (
          <div className="h-20 animate-pulse rounded-xl bg-slate-200/70" />
        ) : loadError ? (
          <p className="m-0 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {loadError}
          </p>
        ) : creditOptions.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
            No monetizable leave credits are available.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {creditOptions.map((option) => {
              const active = creditCode === option.code;

              return (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => onChange?.("monetizationCreditCode", option.code)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-teal-500 bg-teal-50 ring-2 ring-teal-100"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{option.leaveType}</span>
                    <Coins size={15} className={active ? "text-teal-700" : "text-slate-400"} />
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatMonetizationDays(option.available)} day(s) available
                    {Number(option.pendingMonetization) > 0
                      ? ` - ${formatMonetizationDays(option.pendingMonetization)} awaiting approval`
                      : ""}
                  </span>
                  {/* Why this credit cannot be filed, or how much of it the rules still allow. */}
                  {option.eligible === false ? (
                    <span className="mt-1 block text-xs font-semibold text-amber-700">
                      {Number(option.remaining || 0) < rules.minimumAccumulatedDays
                        ? `Needs ${formatMonetizationDays(rules.minimumAccumulatedDays)} accumulated day(s)`
                        : `Below the ${formatMonetizationDays(rules.minimumRequestDays)}-day minimum filing`}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-slate-500">
                      Up to {formatMonetizationDays(option.maxRequestable)} day(s) monetizable now
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {errors.monetizationCreditCode ? (
          <p className="m-0 mt-1 text-xs text-rose-700">{errors.monetizationCreditCode}</p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">
            Number of credits to monetize
          </span>
          <input
            type="number"
            min={String(rules.minimumRequestDays)}
            step="0.5"
            value={numberOfDays}
            placeholder={String(rules.minimumRequestDays)}
            onChange={(event) => onChange?.("monetizationDays", event.target.value)}
            className={fieldClassName}
          />
          {daysError || errors.monetizationDays ? (
            <p className="m-0 mt-1 text-xs text-rose-700">{daysError || errors.monetizationDays}</p>
          ) : null}
        </label>

        <label>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Date of filing</span>
          <input
            type="date"
            value={dateFiled}
            onChange={(event) => onChange?.("monetizationDateFiled", event.target.value)}
            className={fieldClassName}
          />
          {errors.monetizationDateFiled ? (
            <p className="m-0 mt-1 text-xs text-rose-700">{errors.monetizationDateFiled}</p>
          ) : null}
        </label>
      </div>

      {/* The CSC ceilings, spelled out so the desk knows the shape of a valid filing up front. */}
      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        <p className="m-0 text-sm font-semibold text-slate-700">Civil Service monetization rules</p>
        <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-4">
          <li>
            At least {formatMonetizationDays(rules.minimumAccumulatedDays)} accumulated credit(s)
            before any may be monetized.
          </li>
          <li>Minimum {formatMonetizationDays(rules.minimumRequestDays)} day(s) per monetization.</li>
          <li>At least {formatMonetizationDays(rules.retainedDays)} day(s) must remain afterwards.</li>
          <li>
            Maximum {formatMonetizationDays(rules.annualCapDays)} day(s) a year across all leave
            credits{" - "}
            <span className="font-semibold text-slate-800">
              {formatMonetizationDays(annualRemaining)} day(s) left
              {creditSummary?.year ? ` in ${creditSummary.year}` : ""}
            </span>
            {yearToDateMonetized > 0
              ? ` (${formatMonetizationDays(yearToDateMonetized)} already monetized or awaiting approval)`
              : ""}
          </li>
        </ul>
      </div>

      {needsJustification ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="m-0 text-sm font-semibold">50% or more of accumulated credits</p>
          <p className="m-0 mt-1">
            {formatMonetizationDays(requestedDays)} of {formatMonetizationDays(accumulatedDays)}{" "}
            accumulated day(s). Monetizing half or more is allowed only for a valid and justifiable
            reason - health, financial aid, educational, or calamity - so the purpose below is
            required and is weighed by the HR Head and the Regional Director.
          </p>
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-600">Daily rate</span>
          <span className="font-semibold text-slate-900">{currencyFormatter.format(dailyRate)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-slate-600">Estimated monetized value</span>
          <span className="font-semibold text-slate-900">
            {currencyFormatter.format(estimatedAmount)}
          </span>
        </div>
        <p className="m-0 mt-2 text-xs text-slate-500">
          Daily rate uses the Civil Service constant factor (monthly salary x 0.0481170). The final
          amount is confirmed during payroll processing.
        </p>
      </div>
    </div>
  );
}
