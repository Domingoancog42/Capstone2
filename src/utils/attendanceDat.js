export const ATTENDANCE_DAT_MB_LIMIT = 10;
export const ATTENDANCE_DAT_BYTE_LIMIT = ATTENDANCE_DAT_MB_LIMIT * 1024 * 1024;

/*
 * An attendance import covers one payroll cut-off. Unlike payroll's pay-period ranges (which stop
 * at the 30th and share day 15), an attendance cut-off must account for every calendar day exactly
 * once, so the halves meet at 15/16 and the month runs to its real last day.
 */
export const ATTENDANCE_CUTOFF_OPTIONS = [
  { value: "1st Half", label: "1st Half (1–15)" },
  { value: "2nd Half", label: "2nd Half (16–end of month)" },
  { value: "Monthly", label: "Monthly (whole month)" },
];

const ATTENDANCE_IMPORT_HEADERS = ["Employee ID", "Date & Time", "State C", "State D", "State E", "State F"];
const DAT_DATE_TIME_PATTERN =
  /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})[T\s,;|"']+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)/i;

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function cleanDatToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^["']|["']$/g, "");
}

function splitDatFields(value) {
  const text = cleanDatToken(value);

  if (text.includes("\t")) {
    return text.split("\t").map(cleanDatToken).filter(Boolean);
  }

  if (text.includes(",")) {
    return text.split(",").map(cleanDatToken).filter(Boolean);
  }

  if (text.includes(";")) {
    return text.split(";").map(cleanDatToken).filter(Boolean);
  }

  return text.split(/\s+/).map(cleanDatToken).filter(Boolean);
}

function normalizeDatDateTime(datePart, timePart) {
  const dateText = cleanDatToken(datePart);
  const timeText = cleanDatToken(timePart).toUpperCase().replace(/\s+/g, " ");
  const isoMatch = dateText.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")} ${timeText}`;
  }

  return `${dateText} ${timeText}`;
}

function normalizeDatDate(datePart) {
  const dateText = cleanDatToken(datePart);
  const isoMatch = dateText.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }

  // Attendance imports already interpret non-ISO dates as month/day/year. Use the same convention
  // here so pay-period detection and the server import cannot disagree about which half a row is in.
  const localMatch = dateText.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!localMatch) {
    return "";
  }

  const year = localMatch[3].length === 2 ? `20${localMatch[3]}` : localMatch[3];
  return `${year}-${localMatch[1].padStart(2, "0")}-${localMatch[2].padStart(2, "0")}`;
}

function stateFromPunchType(type) {
  return type === "time_out" ? ["1", "1", "1", "0"] : ["1", "0", "1", "0"];
}

/*
 * ZKTeco-style transaction logs use one punch-status field followed by verification/work-code
 * metadata. Those columns can look like four binary state columns, but they are not the canonical
 * four-bit state the attendance API consumes. Normalize the common device codes here so a regular
 * `attlog.dat` row reaches the API as the same TIME IN / TIME OUT states used by CSV imports.
 */
function stateFromDevicePunchCode(value) {
  const match = cleanDatToken(value).match(/^(?:status|state|punch|inout|io)?\s*[:=]?\s*([0-5])$/i);
  const code = match?.[1] || "";

  if (["0", "3", "4"].includes(code)) {
    return stateFromPunchType("time_in");
  }

  if (["1", "2", "5"].includes(code)) {
    return stateFromPunchType("time_out");
  }

  return null;
}

function extractPunchState(tokens, sourceText) {
  const compactState = tokens.map(cleanDatToken).find((token) => /^[01]{4}$/.test(token));

  if (["1010", "1110"].includes(compactState)) {
    return compactState.split("");
  }

  const binaryTokens = tokens.map(cleanDatToken).filter((token) => token === "0" || token === "1");
  const firstFourBinaryState = binaryTokens.slice(0, 4).join("");

  if (["1010", "1110"].includes(firstFourBinaryState)) {
    return binaryTokens.slice(0, 4);
  }

  const normalizedTokens = tokens.map((token) => cleanDatToken(token).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const normalizedSource = String(sourceText || "").toLowerCase();

  if (
    normalizedTokens.some((token) => ["timein", "checkin", "clockin", "punchin", "signin", "in", "i"].includes(token))
    || /\b(time\s*in|check\s*in|clock\s*in|punch\s*in|sign\s*in)\b/i.test(normalizedSource)
  ) {
    return stateFromPunchType("time_in");
  }

  if (
    normalizedTokens.some((token) => ["timeout", "checkout", "clockout", "punchout", "signout", "out", "o"].includes(token))
    || /\b(time\s*out|check\s*out|clock\s*out|punch\s*out|sign\s*out)\b/i.test(normalizedSource)
  ) {
    return stateFromPunchType("time_out");
  }

  const labeledDeviceStatus = String(sourceText || "").match(
    /\b(?:status|state|punch|in[\s_-]*out|io)\s*[:=]?\s*([0-5])\b/i
  );
  const deviceState = stateFromDevicePunchCode(
    labeledDeviceStatus?.[1] || (compactState ? compactState[0] : tokens[0])
  );

  if (deviceState) {
    return deviceState;
  }

  return null;
}

function parseDatAttendanceLine(line) {
  const text = cleanDatToken(line);
  const dateTimeMatch = text.match(DAT_DATE_TIME_PATTERN);

  if (!dateTimeMatch) {
    return null;
  }

  const beforeDateTime = text.slice(0, dateTimeMatch.index).trim();
  const afterDateTime = text.slice((dateTimeMatch.index || 0) + dateTimeMatch[0].length).trim();
  const employeeTokens = splitDatFields(beforeDateTime).filter((token) => !/^(no|number|id|user|employee|emp|code)$/i.test(token));
  const afterTokens = splitDatFields(afterDateTime);
  let stateTokens = afterTokens;
  let employeeCode =
    [...employeeTokens].reverse().find((token) => /^[a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*$/i.test(token))
    || employeeTokens[employeeTokens.length - 1]
    || "";

  if (!employeeCode) {
    const employeeTokenIndex = afterTokens.findIndex(
      (token) => /^[a-z0-9][a-z0-9_-]*\d[a-z0-9_-]*$/i.test(token) && !/^[01]{1,4}$/.test(token)
    );

    if (employeeTokenIndex >= 0) {
      employeeCode = afterTokens[employeeTokenIndex];
      stateTokens = afterTokens.filter((_, index) => index !== employeeTokenIndex);
    }
  }

  const state = extractPunchState(stateTokens, afterDateTime);
  const date = normalizeDatDate(dateTimeMatch[1]);

  if (!employeeCode || !state || !date) {
    return null;
  }

  return {
    csvRow: [employeeCode, normalizeDatDateTime(dateTimeMatch[1], dateTimeMatch[2]), ...state],
    date,
  };
}

function isLikelyDatHeader(line) {
  const text = String(line || "").toLowerCase();
  return /employee|emp|user|date|time|state|punch|check/.test(text) && !DAT_DATE_TIME_PATTERN.test(text);
}

export function detectAttendanceFilePayPeriod(dates = []) {
  const days = dates
    .map((date) => Number.parseInt(String(date || "").slice(8, 10), 10))
    .filter(Number.isFinite);
  // Day 15 is the boundary shared by this project's two payroll ranges. Treat it as neutral when
  // other dates are present: 1-15 remains a first-half file and 15-30 remains a second-half file.
  const includesFirstHalf = days.some((day) => day < 15);
  const includesSecondHalf = days.some((day) => day > 15);

  if (includesFirstHalf && includesSecondHalf) {
    return "Monthly";
  }

  if (includesFirstHalf) {
    return "1st Half";
  }

  return includesSecondHalf ? "2nd Half" : days.includes(15) ? "1st Half" : "";
}

export function decodeAttendanceDatBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  if (bytes.length === 0) {
    return "";
  }

  const sampleLength = Math.min(bytes.length, 512);
  let evenNulls = 0;
  let oddNulls = 0;

  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) {
      continue;
    }

    if (index % 2 === 0) {
      evenNulls += 1;
    } else {
      oddNulls += 1;
    }
  }

  const hasUtf16LeBom = bytes[0] === 0xff && bytes[1] === 0xfe;
  const hasUtf16BeBom = bytes[0] === 0xfe && bytes[1] === 0xff;
  const likelyUtf16Le = oddNulls > sampleLength * 0.18 && oddNulls > evenNulls * 2;
  const likelyUtf16Be = evenNulls > sampleLength * 0.18 && evenNulls > oddNulls * 2;
  const encoding = hasUtf16LeBom || likelyUtf16Le
    ? "utf-16le"
    : hasUtf16BeBom || likelyUtf16Be
      ? "utf-16be"
      : "utf-8";
  const withoutNullCharacters = (text) => String(text).split("\u0000").join("");

  try {
    return withoutNullCharacters(new TextDecoder(encoding).decode(bytes));
  } catch {
    // Older browsers may not expose both UTF-16 labels. Stripping NULs still recovers the numeric
    // tabular content used by biometric exports and lets the parser report a useful format error.
    return withoutNullCharacters(new TextDecoder("utf-8").decode(bytes));
  }
}

export async function readAttendanceDatFile(file) {
  if (!file) {
    return "";
  }

  if (typeof file.arrayBuffer === "function") {
    return decodeAttendanceDatBytes(await file.arrayBuffer());
  }

  if (typeof file.text === "function") {
    return String(await file.text()).split("\u0000").join("");
  }

  throw new Error("This browser cannot read the selected DAT file.");
}

function attendanceCsvSegment(parsedRows, payPeriod) {
  const segmentRows = parsedRows.filter(({ date }) => {
    const day = Number.parseInt(String(date).slice(8, 10), 10);
    return payPeriod === "1st Half" ? day <= 15 : day >= 15;
  });
  const dates = Array.from(new Set(segmentRows.map(({ date }) => date))).sort();

  if (segmentRows.length === 0) {
    return null;
  }

  return {
    csv: [ATTENDANCE_IMPORT_HEADERS, ...segmentRows.map(({ csvRow }) => csvRow)]
      .map((row) => row.map(csvCell).join(","))
      .join("\n"),
    rowCount: segmentRows.length,
    dates,
    dateFrom: dates[0] || "",
    dateTo: dates[dates.length - 1] || "",
  };
}

export function convertDatTextToAttendanceCsv(text) {
  const rows = [ATTENDANCE_IMPORT_HEADERS];
  const parsedRows = [];
  const dates = [];
  let skippedRows = 0;

  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line.trim()) {
        return;
      }

      const parsed = parseDatAttendanceLine(line);
      if (parsed) {
        rows.push(parsed.csvRow);
        parsedRows.push(parsed);
        dates.push(parsed.date);
        return;
      }

      if (!isLikelyDatHeader(line)) {
        skippedRows++;
      }
    });

  if (rows.length === 1) {
    throw new Error("No attendance rows could be converted from this DAT file.");
  }

  const uniqueDates = Array.from(new Set(dates)).sort();
  const months = Array.from(new Set(uniqueDates.map((date) => date.slice(0, 7))));

  return {
    csv: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    rowCount: rows.length - 1,
    skippedRows,
    /* Kept so a caller can re-cut the same file to another period without re-parsing it. */
    rows: parsedRows,
    dates: uniqueDates,
    dateFrom: uniqueDates[0] || "",
    dateTo: uniqueDates[uniqueDates.length - 1] || "",
    month: months.length === 1 ? months[0] : "",
    spansMultipleMonths: months.length > 1,
    payPeriod: detectAttendanceFilePayPeriod(uniqueDates),
    segments: {
      "1st Half": attendanceCsvSegment(parsedRows, "1st Half"),
      "2nd Half": attendanceCsvSegment(parsedRows, "2nd Half"),
    },
  };
}

function isAttendanceCutoffMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

/** The calendar range one cut-off covers in a given `YYYY-MM` month, or null when either is unusable. */
export function getAttendanceCutoffRange(cutoff, month) {
  if (!isAttendanceCutoffMonth(month) || !ATTENDANCE_CUTOFF_OPTIONS.some((option) => option.value === cutoff)) {
    return null;
  }

  const [year, monthNumber] = month.split("-").map((part) => Number.parseInt(part, 10));
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const day = (value) => `${month}-${String(value).padStart(2, "0")}`;

  if (cutoff === "1st Half") {
    return { dateFrom: day(1), dateTo: day(15) };
  }

  if (cutoff === "2nd Half") {
    return { dateFrom: day(16), dateTo: day(lastDay) };
  }

  return { dateFrom: day(1), dateTo: day(lastDay) };
}

export function formatAttendanceCutoffLabel(cutoff, month) {
  const range = getAttendanceCutoffRange(cutoff, month);
  if (!range) {
    return "";
  }

  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const dayOf = (date) => Number.parseInt(date.slice(8, 10), 10);

  return `${monthName} · ${cutoff} (${dayOf(range.dateFrom)}–${dayOf(range.dateTo)})`;
}

/**
 * Cuts a converted DAT file down to the rows inside one cut-off. Rows outside it are counted, not
 * dropped silently, so the importer can say how much of the file is being left out.
 */
export function buildAttendanceCutoffCsv(converted, range) {
  const rows = Array.isArray(converted?.rows) ? converted.rows : [];
  const dateFrom = String(range?.dateFrom || "");
  const dateTo = String(range?.dateTo || "");

  if (!dateFrom || !dateTo) {
    return null;
  }

  const includedRows = rows.filter(({ date }) => date >= dateFrom && date <= dateTo);
  const dates = Array.from(new Set(includedRows.map(({ date }) => date))).sort();

  return {
    csv: [ATTENDANCE_IMPORT_HEADERS, ...includedRows.map(({ csvRow }) => csvRow)]
      .map((row) => row.map(csvCell).join(","))
      .join("\n"),
    rowCount: includedRows.length,
    excludedRows: rows.length - includedRows.length,
    dates,
    dateFrom,
    dateTo,
  };
}

export function formatAttendanceFileSize(bytes = 0) {
  const value = Number(bytes) || 0;

  if (value <= 0) {
    return "0 KB";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}
