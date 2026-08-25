import { buildDailyTimeRecordRows, dailyTimeRecordFileName } from "./DailyTimeRecord";

/*
 * These cover the row builder rather than an export format: it is what fills the on-screen CS Form
 * No. 48, what the print window writes out, and — since the sheet is painted rather than redrawn —
 * what ends up in the PDF. One set of rules, three destinations.
 */

const DTR = {
  month: "2026-02",
  startDate: "2026-02-01",
  endDate: "2026-02-28",
  employee: {
    employeeId: "EMP-001",
    employeeName: "Juan Dela Cruz",
    department: "Finance Division",
    position: "Administrative Officer",
  },
  records: [{
    date: "2026-02-02",
    amTimeIn: "2026-02-02 08:05:00",
    amTimeOut: "2026-02-02 12:00:00",
    pmTimeIn: "2026-02-02 13:00:00",
    pmTimeOut: "2026-02-02 17:00:00",
    totalMinutes: 475,
    lateMinutes: 5,
    undertimeMinutes: 0,
    status: "Late",
    source: "Biometric",
  }],
  leaveDates: { "2026-02-03": "LWP", "2026-02-05": "LWOP" },
};

function rowFor(rows, date) {
  return rows.find((row) => row.date === date);
}

describe("Daily Time Record rows", () => {
  test("every day of the month gets a row, worked or not", () => {
    expect(buildDailyTimeRecordRows(DTR)).toHaveLength(28);
    expect(buildDailyTimeRecordRows({ ...DTR, month: "2026-01" })).toHaveLength(31);
    // 2028 is a leap year, so February has to come back with 29 rows and not 28.
    expect(buildDailyTimeRecordRows({ ...DTR, month: "2028-02" })).toHaveLength(29);
  });

  test("a worked day carries its four punches and its late and undertime minutes", () => {
    const row = rowFor(buildDailyTimeRecordRows(DTR), "2026-02-02");

    expect(row.day).toBe("2 Mon");
    expect(row.amArrival).toBe("8:05 am");
    expect(row.amDep).toBe("12:00 pm");
    expect(row.pmArrival).toBe("1:00 pm");
    expect(row.pmDep).toBe("5:00 pm");
    expect(row.T).toBe("5");
    expect(row.U).toBe("0");
    expect(row.status).toBe("Late");
  });

  test("a leave day is marked in all four time columns", () => {
    const rows = buildDailyTimeRecordRows(DTR);
    const withPay = rowFor(rows, "2026-02-03");
    const withoutPay = rowFor(rows, "2026-02-05");

    expect([withPay.amArrival, withPay.amDep, withPay.pmArrival, withPay.pmDep])
      .toEqual(["LWP", "LWP", "LWP", "LWP"]);
    expect(withPay.status).toBe("Leave With Pay");
    expect(withoutPay.status).toBe("Leave Without Pay");
    // A leave day has no late or undertime to report; a zero there would read as "on time".
    expect(withPay.T).toBe("--");
    expect(withPay.U).toBe("--");
  });

  /*
   * A record whose status is the leave itself, with no entry in `leaveDates`. Both routes have to
   * reach the same row, or a DTR would show blank punches for a day that was accounted for.
   */
  test("a leave status on the record marks the day even without a leaveDates entry", () => {
    const rows = buildDailyTimeRecordRows({
      ...DTR,
      leaveDates: {},
      records: [{ date: "2026-02-09", status: "Leave Without Pay" }],
    });

    expect(rowFor(rows, "2026-02-09").amArrival).toBe("LWOP");
  });

  test("a day with no record is present and dashed rather than omitted", () => {
    const row = rowFor(buildDailyTimeRecordRows(DTR), "2026-02-10");

    expect(row.day).toBe("10 Tue");
    expect([row.amArrival, row.amDep, row.pmArrival, row.pmDep, row.T, row.U])
      .toEqual(["--", "--", "--", "--", "--", "--"]);
  });

  /*
   * Older imported records carry a single in/out pair instead of the AM/PM split, so those have to
   * land in the morning-arrival and afternoon-departure boxes rather than leaving the row blank.
   */
  test("a record with only timeIn and timeOut still fills the outer columns", () => {
    const rows = buildDailyTimeRecordRows({
      ...DTR,
      leaveDates: {},
      records: [{ date: "2026-02-11", timeIn: "2026-02-11 07:45:00", timeOut: "2026-02-11 16:45:00" }],
    });
    const row = rowFor(rows, "2026-02-11");

    expect(row.amArrival).toBe("7:45 am");
    expect(row.pmDep).toBe("4:45 pm");
    expect(row.amDep).toBe("--");
    expect(row.pmArrival).toBe("--");
  });

  test("a malformed month yields no rows instead of throwing", () => {
    expect(buildDailyTimeRecordRows({ month: "not-a-month" })).toEqual([]);
  });
});

describe("Daily Time Record PDF file name", () => {
  test("names the file after the employee and month", () => {
    expect(dailyTimeRecordFileName(DTR)).toBe("DTR-CS-Form-48-EMP-001-2026-02.pdf");
  });

  test("falls back rather than producing a nameless or unsafe file", () => {
    expect(dailyTimeRecordFileName({})).toBe("DTR-CS-Form-48-employee-month.pdf");
    expect(dailyTimeRecordFileName({ month: "2026-02", employee: { employeeId: "MGB/10 021" } }))
      .toBe("DTR-CS-Form-48-MGB-10-021-2026-02.pdf");
  });
});
