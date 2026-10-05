const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizedStatus = (value) => {
  const status = String(value || "").trim().toLowerCase();
  if (status === "reviewed") return "Pending";
  return status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : "Unspecified";
};

const group = (rows, labelKey, valueForRow = () => 1) => {
  const totals = new Map();

  rows.forEach((row) => {
    const label = String(row[labelKey] || "Unspecified").trim() || "Unspecified";
    totals.set(label, numberValue(totals.get(label)) + numberValue(valueForRow(row)));
  });

  return Array.from(totals, ([label, value]) => ({ label, value: Number(value.toFixed(2)) }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
};

const statusDistribution = (rows) => {
  const order = ["Approved", "Pending", "Rejected", "Cancelled"];
  const counts = new Map(order.map((status) => [status, 0]));

  rows.forEach((row) => {
    const status = normalizedStatus(row.status);
    counts.set(status, (counts.get(status) || 0) + 1);
  });

  return Array.from(counts, ([label, value]) => ({ label, value })).filter((entry) => entry.value > 0);
};

const monthSeries = (rows, dateKey, valueForRow = () => 1) => {
  const months = new Map();

  rows.forEach((row) => {
    const rawDate = String(row[dateKey] || "");
    const match = rawDate.match(/^(\d{4})-(\d{2})/);
    if (!match) return;

    const key = `${match[1]}-${match[2]}`;
    months.set(key, numberValue(months.get(key)) + numberValue(valueForRow(row)));
  });

  return Array.from(months, ([key, value]) => {
    const date = new Date(`${key}-01T12:00:00`);
    return {
      key,
      label: date.toLocaleDateString("en-PH", { month: "short", year: "numeric" }),
      value: Number(value.toFixed(2)),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
};

const uniqueEmployeeCount = (rows) => new Set(
  rows.map((row) => String(row.employeeNo || row.employeeName || "").trim()).filter(Boolean)
).size;

const sum = (rows, key) => rows.reduce((total, row) => total + numberValue(row[key]), 0);

const kpi = (key, label, value, format = "number", hint = "") => ({ key, label, value, format, hint });

function applicationsAnalytics(rows) {
  const statuses = statusDistribution(rows);
  const statusValue = (name) => statuses.find((entry) => entry.label === name)?.value || 0;

  return {
    kpis: [
      kpi("total", "Total Applications", rows.length),
      kpi("approved", "Approved", statusValue("Approved")),
      kpi("pending", "Pending", statusValue("Pending")),
      kpi("rejected", "Rejected", statusValue("Rejected")),
      kpi("cancelled", "Cancelled", statusValue("Cancelled")),
      kpi("days", "Total Leave Days", sum(rows, "totalDays"), "days"),
    ],
    charts: [
      { key: "status", title: "Applications by Status", type: "donut", data: statuses },
      { key: "trend", title: "Monthly Leave Application Trend", type: "line", data: monthSeries(rows, "dateFiled") },
      { key: "type", title: "Applications by Leave Type", type: "bar", data: group(rows, "leaveType") },
      { key: "division", title: "Applications by Division/Department", type: "bar", data: group(rows, "division") },
    ],
  };
}

function monetizationAnalytics(rows) {
  const statuses = statusDistribution(rows);
  const approvedRows = rows.filter((row) => normalizedStatus(row.status) === "Approved");
  const statusValue = (name) => statuses.find((entry) => entry.label === name)?.value || 0;

  return {
    kpis: [
      kpi("total", "Total Requests", rows.length),
      kpi("approved", "Approved Requests", statusValue("Approved")),
      kpi("pending", "Pending Requests", statusValue("Pending")),
      kpi("rejected", "Rejected Requests", statusValue("Rejected")),
      kpi("days", "Total Days Monetized", sum(approvedRows, "daysApproved"), "days"),
      kpi("amount", "Total Monetized Amount", sum(approvedRows, "computedAmount"), "currency"),
    ],
    charts: [
      { key: "status", title: "Monetization Requests by Status", type: "donut", data: statuses },
      {
        key: "division",
        title: "Monetized Amount by Division/Department",
        type: "bar",
        currency: true,
        data: group(approvedRows, "division", (row) => row.computedAmount),
      },
      { key: "trend", title: "Monthly Monetization Trend", type: "line", data: monthSeries(rows, "dateRequested") },
    ],
  };
}

function balanceAnalytics(rows) {
  const employeeBalances = new Map();
  rows.forEach((row) => {
    const employee = String(row.employeeNo || row.employeeName || "Unspecified");
    employeeBalances.set(employee, numberValue(employeeBalances.get(employee)) + numberValue(row.remainingBalance));
  });

  const balanceRanges = [
    { label: "Zero", min: Number.NEGATIVE_INFINITY, max: 0, value: 0 },
    { label: "0.01 - 5.00", min: 0, max: 5, value: 0 },
    { label: "5.01 - 10.00", min: 5, max: 10, value: 0 },
    { label: "10.01 - 20.00", min: 10, max: 20, value: 0 },
    { label: "Above 20.00", min: 20, max: Number.POSITIVE_INFINITY, value: 0 },
  ];
  Array.from(employeeBalances.values()).forEach((balance) => {
    const range = balanceRanges.find((entry, index) => (
      index === 0 ? balance <= entry.max : balance > entry.min && balance <= entry.max
    ));
    if (range) range.value += 1;
  });

  const divisions = new Map();
  rows.forEach((row) => {
    const label = String(row.division || "Unspecified");
    const current = divisions.get(label) || { total: 0, count: 0 };
    current.total += numberValue(row.remainingBalance);
    current.count += 1;
    divisions.set(label, current);
  });
  const divisionAverages = Array.from(divisions, ([label, values]) => ({
    label,
    value: Number((values.total / Math.max(values.count, 1)).toFixed(2)),
  })).sort((left, right) => right.value - left.value);

  const vacationBalance = rows
    .filter((row) => /vacation/i.test(String(row.leaveType || "")))
    .reduce((total, row) => total + numberValue(row.remainingBalance), 0);
  const sickBalance = rows
    .filter((row) => /sick/i.test(String(row.leaveType || "")))
    .reduce((total, row) => total + numberValue(row.remainingBalance), 0);
  const lowBalanceEmployees = new Set(
    rows
      .filter((row) => numberValue(row.remainingBalance) > 0 && numberValue(row.remainingBalance) <= 5)
      .map((row) => String(row.employeeNo || row.employeeName || "").trim())
      .filter(Boolean)
  );
  const zeroBalanceEmployees = new Set(
    rows
      .filter((row) => numberValue(row.remainingBalance) <= 0)
      .map((row) => String(row.employeeNo || row.employeeName || "").trim())
      .filter(Boolean)
  );

  return {
    kpis: [
      kpi("employees", "Total Employees", uniqueEmployeeCount(rows)),
      kpi("credits", "Total Available Credits", sum(rows, "remainingBalance"), "days"),
      kpi("vacation", "Vacation Leave Balance", vacationBalance, "days"),
      kpi("sick", "Sick Leave Balance", sickBalance, "days"),
      kpi("low", "Employees with Low Balance", lowBalanceEmployees.size),
      kpi("zero", "Employees with Zero Balance", zeroBalanceEmployees.size),
    ],
    charts: [
      {
        key: "type",
        title: "Leave Balance by Leave Type",
        type: "horizontalBar",
        data: group(rows, "leaveType", (row) => row.remainingBalance),
      },
      { key: "division", title: "Average Leave Balance by Division/Department", type: "bar", data: divisionAverages },
      { key: "ranges", title: "Employees by Balance Range", type: "bar", ordinal: true, data: balanceRanges },
    ],
  };
}

function utilizationAnalytics(rows) {
  const employees = Math.max(uniqueEmployeeCount(rows), 1);
  const byType = group(rows, "leaveType", (row) => row.totalDaysUsed);
  const mostUsed = byType[0]?.label || "No data";
  const paySplit = new Map();

  rows.forEach((row) => {
    const label = String(row.leaveType || "Unspecified");
    const current = paySplit.get(label) || { label, withPay: 0, withoutPay: 0 };
    current.withPay += numberValue(row.withPay);
    current.withoutPay += numberValue(row.withoutPay);
    paySplit.set(label, current);
  });

  return {
    kpis: [
      kpi("days", "Total Leave Days Used", sum(rows, "totalDaysUsed"), "days"),
      kpi("employees", "Employees Who Used Leave", uniqueEmployeeCount(rows)),
      kpi("type", "Most Used Leave Type", mostUsed, "text"),
      kpi("average", "Average Days Used", rows.length ? sum(rows, "totalDaysUsed") / employees : 0, "days"),
      kpi("paid", "With Pay Days", sum(rows, "withPay"), "days"),
      kpi("unpaid", "Without Pay Days", sum(rows, "withoutPay"), "days"),
    ],
    charts: [
      { key: "type", title: "Leave Usage by Leave Type", type: "bar", data: byType },
      {
        key: "trend",
        title: "Monthly Leave Utilization Trend",
        type: "line",
        data: monthSeries(rows, "startDateRaw", (row) => row.totalDaysUsed),
      },
      {
        key: "division",
        title: "Leave Usage by Division/Department",
        type: "bar",
        data: group(rows, "division", (row) => row.totalDaysUsed),
      },
      {
        key: "paySplit",
        title: "With Pay vs Without Pay",
        type: "stackedBar",
        data: Array.from(paySplit.values()).sort((left, right) => (
          (right.withPay + right.withoutPay) - (left.withPay + left.withoutPay)
        )),
      },
    ],
  };
}

export function buildLeaveReportAnalytics(reportKey, rows = []) {
  if (reportKey === "leave-monetization") return monetizationAnalytics(rows);
  if (reportKey === "leave-balance") return balanceAnalytics(rows);
  if (reportKey === "leave-utilization") return utilizationAnalytics(rows);
  return applicationsAnalytics(rows);
}

export { group, monthSeries, normalizedStatus, numberValue, statusDistribution, sum, uniqueEmployeeCount };
