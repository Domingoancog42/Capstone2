import React, { useEffect, useMemo, useState } from "react";

const cellInput = {
  border: "none",
  outline: "none",
  background: "transparent",
  textAlign: "center",
  fontSize: "11px",
  fontFamily: '"Times New Roman", Times, serif',
  width: "100%",
  padding: 0,
};

function parseLocalDate(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = parseLocalDate(value);
  if (!date) {
    return "--";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
}

function formatMonth(month) {
  const date = parseLocalDate(`${month || new Date().toISOString().slice(0, 7)}-01T00:00:00`);
  if (!date) {
    return month || "";
  }

  return date.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
}

function normalizeLeaveCode(value) {
  const text = String(value || "").trim().toUpperCase();
  return text === "LWP" || text === "LWOP" ? text : "";
}

function leaveCodeForDate(dateKey, record, leaveDates) {
  const dateLeaveCode = normalizeLeaveCode(leaveDates?.[dateKey]);
  if (dateLeaveCode) {
    return dateLeaveCode;
  }

  const status = String(record?.status || "").toLowerCase();
  if (status === "leave with pay") {
    return "LWP";
  }

  if (status === "leave without pay") {
    return "LWOP";
  }

  return "";
}

export function buildDailyTimeRecordRows(dtr) {
  const month = dtr?.month || new Date().toISOString().slice(0, 7);
  const start = parseLocalDate(`${month}-01T00:00:00`);
  const recordsByDate = new Map((dtr?.records || []).map((record) => [record.date, record]));
  const leaveDates = dtr?.leaveDates || {};

  if (!start) {
    return [];
  }

  const year = start.getFullYear();
  const monthIndex = start.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, monthIndex, day);
    const dateKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const record = recordsByDate.get(dateKey);
    const leaveCode = leaveCodeForDate(dateKey, record, leaveDates);

    const weekday = date.toLocaleDateString([], { weekday: "short" });

    if (leaveCode) {
      return {
        day: `${day} ${weekday}`,
        date: dateKey,
        amArrival: leaveCode,
        amDep: leaveCode,
        pmArrival: leaveCode,
        pmDep: leaveCode,
        T: "--",
        U: "--",
        status: leaveCode === "LWOP" ? "Leave Without Pay" : "Leave With Pay",
      };
    }

    return {
      day: `${day} ${weekday}`,
      date: dateKey,
      amArrival: record?.amTimeIn || record?.timeIn ? formatTime(record.amTimeIn || record.timeIn) : "--",
      amDep: record?.amTimeOut ? formatTime(record.amTimeOut) : "--",
      pmArrival: record?.pmTimeIn ? formatTime(record.pmTimeIn) : "--",
      pmDep: record?.pmTimeOut || record?.timeOut ? formatTime(record.pmTimeOut || record.timeOut) : "--",
      T: record?.lateMinutes || record?.lateMinutes === 0 ? String(record.lateMinutes) : "--",
      U: record?.undertimeMinutes || record?.undertimeMinutes === 0 ? String(record.undertimeMinutes) : "--",
      status: String(record?.status || ""),
    };
  });
}

export function dailyTimeRecordFileName(dtr) {
  const employeeId = String(dtr?.employee?.employeeId || "employee").replace(/[^A-Za-z0-9-]+/g, "-");
  return `DTR-CS-Form-48-${employeeId}-${dtr?.month || "month"}.pdf`;
}

/** html2canvas paints whatever is on screen, so the MGB seal still loading would land as a blank box. */
function waitForImages(node) {
  const images = Array.from(node?.querySelectorAll?.("img") || []);

  return Promise.all(
    images.map((image) => (
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        })
    )),
  );
}

/**
 * The two preview sheets exactly as they appear, fitted together on one portrait A4 PDF page.
 *
 * Painted from the rendered node rather than redrawn in jsPDF: CS Form No. 48 is a prescribed
 * government layout, and the component above is already the authority on what it looks like. Laying
 * the same boxes out a second time in PDF primitives would give two definitions of one form that
 * would drift apart on the first change to either.
 *
 * The whole element is captured, not the part currently scrolled into view -- html2canvas measures
 * the node's own box, so the modal's horizontal scroller does not clip the export.
 */
export async function exportDailyTimeRecordPdf(node, fileName) {
  if (!node) {
    throw new Error("The Daily Time Record is not ready yet.");
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  await waitForImages(node);

  const canvas = await html2canvas(node, {
    // The sheet is only 450px wide and dense with 11px type; 3x keeps the times legible in print.
    scale: 3,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const scale = Math.min(
    (pageWidth - margin * 2) / canvas.width,
    (pageHeight - margin * 2) / canvas.height,
  );
  const width = canvas.width * scale;
  const height = canvas.height * scale;

  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    (pageWidth - width) / 2,
    margin,
    width,
    height,
  );
  pdf.save(fileName);
}

export default function DailyTimeRecord({
  dtr,
  editable = false,
  signatureDataUrl = "",
  copyLabel = "ORIGINAL COPY",
}) {
  const generatedRows = useMemo(() => buildDailyTimeRecordRows(dtr), [dtr]);
  const [name, setName] = useState(dtr?.employee?.employeeName || "");
  const [month, setMonth] = useState(formatMonth(dtr?.month));
  const [regularHours, setRegularHours] = useState("8.00");
  const [satHours, setSatHours] = useState("0.00");
  const [rows, setRows] = useState(generatedRows);
  const now = new Date();
  const timestamp = `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}, ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  useEffect(() => {
    setName(dtr?.employee?.employeeName || "");
    setMonth(formatMonth(dtr?.month));
    setRows(generatedRows);
  }, [dtr?.employee?.employeeName, dtr?.month, generatedRows]);

  const updateRow = (rowIndex, field, value) => {
    if (!editable) {
      return;
    }

    setRows((currentRows) =>
      currentRows.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row))
    );
  };

  const s = {
    container: {
      fontFamily: '"Times New Roman", Times, serif',
      width: "450px",
      margin: "0 auto",
      background: "#fff",
      padding: "30px",
      boxShadow: "0 0 10px rgba(0,0,0,0.15)",
      color: "#000",
    },
    timestamp: { fontSize: "10px", marginBottom: "5px" },
    formNum: { fontSize: "10px", fontStyle: "italic", display: "flex", justifyContent: "space-between", marginBottom: "10px" },
    headerInner: { textAlign: "center", marginBottom: "10px", minHeight: "80px", position: "relative" },
    logo: { width: "50px", position: "absolute", left: "5px", top: "-8px", height: "80px", objectFit: "fill" },
    h1: { fontSize: "14px", margin: 0, textTransform: "uppercase" },
    h2: { fontSize: "12px", margin: 0, fontWeight: "bold" },
    empInput: { border: "none", borderBottom: "1px solid black", outline: "none", fontSize: "14px", fontWeight: "bold", textTransform: "uppercase", textAlign: "center", width: "85%", background: "transparent", fontFamily: '"Times New Roman", Times, serif', marginTop: "15px" },
    employeeName: { borderBottom: "1px solid black", display: "inline-block", fontSize: "14px", fontWeight: "bold", marginTop: "15px", minHeight: "18px", textAlign: "center", textTransform: "uppercase", width: "85%" },
    hoursContainer: { marginTop: "15px", fontSize: "11px" },
    monthLine: { marginBottom: "8px", textAlign: "left" },
    monthInput: { border: "none", borderBottom: "1px solid black", outline: "none", fontWeight: "bold", textAlign: "center", width: "220px", fontSize: "11px", background: "transparent", fontFamily: '"Times New Roman", Times, serif' },
    monthValue: { borderBottom: "1px solid black", display: "inline-block", fontWeight: "bold", minWidth: "220px", textAlign: "center" },
    officialRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
    valInput: { border: "none", borderBottom: "1px solid black", outline: "none", textAlign: "center", width: "35px", fontSize: "10px", background: "transparent", fontFamily: '"Times New Roman", Times, serif' },
    val: { borderBottom: "1px solid black", display: "inline-block", minWidth: "35px", textAlign: "center" },
    table: { width: "100%", borderCollapse: "collapse", marginTop: "10px", fontSize: "11px" },
    th: { border: "1.5px solid black", textAlign: "center", padding: "2px", fontFamily: '"Times New Roman", Times, serif' },
    td: { border: "1.5px solid black", textAlign: "center", padding: "2px", height: "18px", fontFamily: '"Times New Roman", Times, serif' },
    dayCell: { textAlign: "left", paddingLeft: "5px", fontWeight: "bold", width: "60px", border: "1.5px solid black" },
    certification: { fontSize: "11px", fontStyle: "italic", textAlign: "center", marginBottom: "30px", lineHeight: 1.4 },
    line: { width: "90%", borderBottom: "1px solid black", margin: "0 auto" },
    caption: { fontSize: "10px", marginTop: "4px", textAlign: "center" },
    /* Sits directly on the signature rule, bottom-aligned so the ink meets the line. */
    signaturePreview: {
      width: "90%",
      margin: "0 auto",
      minHeight: "42px",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
    },
    signatureImage: { maxWidth: "170px", maxHeight: "42px", objectFit: "contain", display: "block" },
    dots: { letterSpacing: "2px", marginTop: "15px", fontSize: "12px", textAlign: "center" },
  };

  const columns = ["amArrival", "amDep", "pmArrival", "pmDep", "T", "U"];

  return (
    <div style={s.container}>
      <div style={s.timestamp}>{timestamp}</div>
      <div style={s.formNum}>
        <span>Civil Service Form No. 48</span>
        <span>&gt;&gt;&gt; {copyLabel}</span>
      </div>

      <div style={s.headerInner}>
        <img src="/mgb.png" alt="MGB Logo" style={s.logo} />
        <h1 style={s.h1}>Mines and Geosciences Bureau - 10</h1>
        <h2 style={s.h2}>DAILY TIME RECORD</h2>
        <div>
          {editable ? (
            <input style={s.empInput} value={name} onChange={(event) => setName(event.target.value)} />
          ) : (
            <span style={s.employeeName}>{name || "Employee"}</span>
          )}
        </div>
      </div>

      <div style={s.hoursContainer}>
        <div style={s.monthLine}>
          For the month of{" "}
          {editable ? (
            <input style={s.monthInput} value={month} onChange={(event) => setMonth(event.target.value)} />
          ) : (
            <span style={s.monthValue}>{month}</span>
          )}
        </div>
        <div style={s.officialRow}>
          <div style={{ fontSize: "11px" }}>Official hours for arrival and departure</div>
          <div style={{ textAlign: "right", lineHeight: 1.3, fontSize: "10px" }}>
            Regular days{" "}
            {editable ? (
              <input style={s.valInput} value={regularHours} onChange={(event) => setRegularHours(event.target.value)} />
            ) : (
              <span style={s.val}>{regularHours}</span>
            )}
            <br />
            Saturdays{" "}
            {editable ? (
              <input style={s.valInput} value={satHours} onChange={(event) => setSatHours(event.target.value)} />
            ) : (
              <span style={s.val}>{satHours}</span>
            )}
          </div>
        </div>
      </div>

      <table style={s.table}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...s.th, width: "15%" }}>Day</th>
            <th colSpan={2} style={{ ...s.th, height: "20px", fontWeight: "bold" }}>A M</th>
            <th colSpan={2} style={{ ...s.th, height: "20px", fontWeight: "bold" }}>P M</th>
            <th colSpan={2} style={{ ...s.th, fontSize: "9px", fontWeight: "bold" }}>REMARKS<br />IN MINUTES</th>
          </tr>
          <tr style={{ fontSize: "9px", fontWeight: "bold" }}>
            <th style={{ ...s.th, width: "15%" }}>Arrival</th>
            <th style={{ ...s.th, width: "15%" }}>Departure</th>
            <th style={{ ...s.th, width: "15%" }}>Arrival</th>
            <th style={{ ...s.th, width: "15%" }}>Departure</th>
            <th style={{ ...s.th, width: "8%" }}>T</th>
            <th style={{ ...s.th, width: "8%" }}>U</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.date || rowIndex}>
              <td style={s.dayCell}>{row.day}</td>
              {columns.map((column) => (
                <td key={column} style={s.td}>
                  {editable ? (
                    <input
                      style={cellInput}
                      value={row[column]}
                      onChange={(event) => updateRow(rowIndex, column, event.target.value)}
                    />
                  ) : (
                    row[column]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "25px", textAlign: "center" }}>
        <div style={s.certification}>
          I certify on my honor that the above is a true and correct report of the<br />
          hours work performed, record of which was daily at the time of arrival<br />
          and departure from office.
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={s.signaturePreview}>
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt={`Signature of ${name || "employee"}`}
                style={s.signatureImage}
              />
            ) : null}
          </div>
          <div style={s.line} />
          <div style={s.caption}>Signature</div>

          <div style={s.dots}>---------------------------------------------------------</div>
          <div style={s.caption}>VERIFIED as to the prescribed office hours</div>

          <div style={{ ...s.line, marginTop: "35px" }} />
          <div style={{ ...s.caption, fontWeight: "bold" }}>In Charge</div>
        </div>
      </div>
    </div>
  );
}
