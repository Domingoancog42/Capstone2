// Match the payslip's allocation of take-home salary to the two monthly payout periods.
export function payrollPayoutAmounts(record = {}) {
  const amount = Number.parseFloat(String(record.netPay ?? 0).replace(/,/g, ""));
  const netPay = Number.isFinite(amount) ? amount : 0;
  const period = String(record.payPeriod || "").trim().toLowerCase();
  if (period === "1st half") return [netPay, 0];
  if (period === "2nd half") return [0, netPay];
  if (period === "monthly") {
    const firstHalf = Math.round((netPay / 2 + Number.EPSILON) * 100) / 100;
    return [firstHalf, Math.round((netPay - firstHalf) * 100) / 100];
  }
  return [0, 0];
}

// An en dash, escaped so an editor that saves in a legacy code page cannot turn it into "?".
const DASH = "–";

export function payrollPayoutLabels(record = {}) {
  const start = new Date(String(record.startDate || record.endDate || "").slice(0, 10) + "T00:00:00");
  const end = new Date(String(record.endDate || record.startDate || "").slice(0, 10) + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [`Salary: 1${DASH}15`, `Salary: 16${DASH}month-end`];
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  return [
    start.toLocaleDateString("en-US", { month: "long" }) + ` 1${DASH}15, ` + start.getFullYear(),
    end.toLocaleDateString("en-US", { month: "long" }) + ` 16${DASH}` + lastDay + ", " + end.getFullYear(),
  ];
}
