import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  SERVICE_RECORD_COLUMN_WIDTHS,
  formatServiceDate,
  serviceRecordNameParts,
  serviceRecordTableRows,
} from "./serviceRecordUtils";

/*
 * The downloaded PDF is the Print view's form (printServiceRecord in serviceRecordUtils.js) drawn as
 * native PDF, so its text stays sharp when printed and Import Record can read it back. Sizes are the
 * print's CSS pixels, which print at 1/96 in, and its table cells come from the same
 * serviceRecordTableRows() so the two cannot drift apart.
 */
const PX = 25.4 / 96;
const MM_PER_PT = 25.4 / 72;
const MARGIN = 10;
const LETTERHEAD_YELLOW = [239, 226, 139];

const LETTERHEAD = [
  ["Republic of the Philippines", 10, "normal"],
  ["Department of Environment and Natural Resources", 10, "normal"],
  ["MINES AND GEOSCIENCES BUREAU", 14, "bold"],
  ["Regional Office No. X", 11, "bold"],
  ["DENR-X Compound, Puntod, Cagayan de Oro City", 9, "normal"],
  ["Telefax Nos. (088) 856-2110; (088) 856-1331 | region10@mgb.gov.ph", 9, "normal"],
];

const CERTIFICATION = "This is to certify that the employee named herein above actually rendered service in this Office as indicated below, each line of which is supported by appointment and other papers actually issued and approved by the authorities concerned.";

// [text, italic and underlined]
const ISSUED = [
  ["Issued in compliance with ", false],
  ["Executive Order No. 54", true],
  [" dated August 10, 1954 and in accordance with ", false],
  ["Circular No. 58", true],
  [" dated August 10, 1954 of the system.", false],
];

/** A CSS pixel font size in points. */
const fontPt = (px) => px * 0.75;

/** The height of a line of text at a CSS line height, in mm. */
const lineBox = (px, lineHeight = 1.15) => fontPt(px) * MM_PER_PT * lineHeight;

/** Where the baseline falls in a line box whose top edge is at `top`. */
const baselineOf = (top, px, lineHeight = 1.15) => top + fontPt(px) * MM_PER_PT * (0.89 + (lineHeight - 1.1) / 2);

/**
 * Breaks runs of plain and emphasised (italic, underlined) text into lines no wider than `maxWidth`.
 * Each line is a list of same-style pieces, so a run is drawn as one piece of text, not word by word.
 */
function emphasisLines(doc, runs, px, maxWidth) {
  doc.setFontSize(fontPt(px));
  const lines = [[]];
  let lineWidth = 0;

  runs.forEach(([text, emphasis]) => {
    doc.setFont("times", emphasis ? "italic" : "normal");
    text.split(/(\s+)/).filter(Boolean).forEach((word) => {
      const width = doc.getTextWidth(word);
      const blank = !word.trim();
      let line = lines[lines.length - 1];

      if (!blank && line.length && lineWidth + width > maxWidth) {
        while (line.length && !line[line.length - 1].text.trim()) {
          lineWidth -= line.pop().width;
        }
        line = [];
        lines.push(line);
        lineWidth = 0;
      }

      if (blank && !line.length) {
        return;
      }

      const last = line[line.length - 1];
      if (last && last.emphasis === emphasis) {
        last.text += word;
        last.width += width;
      } else {
        line.push({ text: word, emphasis, width });
      }
      lineWidth += width;
    });
  });

  return lines;
}

/** Native PDF text stays sharp when printed and can be read back by Import Record. */
export function buildServiceRecordPdf({ employee, records = [], certifiedBy = "", signatureDataUrl = "", logos = [] }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "legal" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const contentWidth = width - MARGIN * 2;
  const right = MARGIN + contentWidth;

  const setText = (px, style = "normal", font = "times") => {
    doc.setFont(font, style);
    doc.setFontSize(fontPt(px));
  };
  const textWidth = (text, px, style = "normal", font = "times") => {
    setText(px, style, font);
    return doc.getTextWidth(text);
  };
  const rule = (x1, x2, y) => {
    doc.setDrawColor(0);
    doc.setLineWidth(PX);
    doc.line(x1, y, x2, y);
  };

  doc.setProperties({ title: `Service Record - ${employee?.fullName || "Employee"}`, subject: "GSIS D 202 (Revised 1989)" });
  doc.setTextColor(0);

  // Masthead: the logos sit right beside the centred agency block, as in the print.
  const logoSize = 95 * PX;
  const logoGap = 16 * PX;
  const blockWidth = Math.max(...LETTERHEAD.map(([text, px, style]) => textWidth(text, px, style)));
  const blockHeight = LETTERHEAD.reduce((sum, [, px]) => sum + lineBox(px), 0) + (LETTERHEAD.length + 1) * PX;
  const mastheadHeight = Math.max(logoSize, blockHeight);
  const groupLeft = MARGIN + (contentWidth - (logoSize * 2 + logoGap * 2 + blockWidth)) / 2;
  const blockCenter = groupLeft + logoSize + logoGap + blockWidth / 2;
  let top = MARGIN + (mastheadHeight - blockHeight) / 2 + PX;

  LETTERHEAD.forEach(([text, px, style]) => {
    setText(px, style);
    doc.text(text, blockCenter, baselineOf(top, px), { align: "center" });
    top += lineBox(px) + PX;
  });

  [logos[0], logos[1]].forEach((logo, index) => {
    if (!logo) return;
    const image = doc.getImageProperties(logo);
    const scale = Math.min(logoSize / image.width, logoSize / image.height);
    const left = index === 0 ? groupLeft : groupLeft + logoSize + logoGap * 2 + blockWidth;
    doc.addImage(
      logo,
      image.fileType,
      left + (logoSize - image.width * scale) / 2,
      MARGIN + (mastheadHeight - image.height * scale) / 2,
      image.width * scale,
      image.height * scale
    );
  });

  // The letterhead's yellow rule, then the GSIS form number.
  let y = MARGIN + mastheadHeight + 8 * PX;
  doc.setFillColor(...LETTERHEAD_YELLOW);
  doc.rect(MARGIN, y, contentWidth, 6 * PX, "F");
  y += 6 * PX + 14 * PX;
  setText(10, "normal", "helvetica");
  doc.text("GSIS D 202 (Revised 1989)", MARGIN, baselineOf(y, 10));
  y += lineBox(10) + 18 * PX;

  // Title, letter-spaced 1px.
  const title = "SERVICE RECORD";
  const titleWidth = textWidth(title, 22, "bold") + PX * title.length;
  doc.text(title, MARGIN + (contentWidth - titleWidth) / 2, baselineOf(y, 22), { charSpace: PX });
  y += lineBox(22) + 14 * PX;

  // NAME: three underlined parts, each captioned beneath.
  const fieldPx = 12;
  setText(fieldPx);
  doc.text("NAME:", MARGIN, baselineOf(y, fieldPx));
  const gridLeft = MARGIN + textWidth("NAME:", fieldPx) + 4 * PX;
  const columnWidth = (right - gridLeft - 24 * PX) / 3;
  const { lastName, givenName, middleName } = serviceRecordNameParts(employee);
  const nameParts = [[lastName, "(Last Name)"], [givenName, "(Given Name)"], [middleName, "(Middle Name)"]].map(
    ([value, caption]) => {
      setText(fieldPx, "bold");
      return { lines: value ? doc.splitTextToSize(value.toUpperCase(), columnWidth - 12 * PX) : [], caption };
    }
  );
  const nameHeight = Math.max(1, ...nameParts.map(({ lines }) => lines.length)) * lineBox(fieldPx);
  const nameUnderline = y + nameHeight + PX / 2;

  nameParts.forEach(({ lines, caption }, index) => {
    const left = gridLeft + index * (columnWidth + 12 * PX);
    const center = left + columnWidth / 2;
    setText(fieldPx, "bold");
    lines.forEach((line, lineIndex) => {
      doc.text(line, center, baselineOf(y + lineIndex * lineBox(fieldPx), fieldPx), { align: "center" });
    });
    rule(left, left + columnWidth, nameUnderline);
    setText(10, "italic");
    doc.text(caption, center, baselineOf(nameUnderline + PX / 2, 10), { align: "center" });
  });
  y = nameUnderline + PX / 2 + lineBox(10) + 4 * PX;

  // BIRTH: date and place fills, the note beside them, captions on the line below.
  const birthDate = formatServiceDate(employee?.dateOfBirth, "");
  const birthPlace = employee?.placeOfBirth || "";
  const note = "(Date herein should be checked from";
  const birthBaseline = baselineOf(y, fieldPx);
  const birthUnderline = y + lineBox(fieldPx) + PX / 2;
  const dateLeft = MARGIN + textWidth("BIRTH:", fieldPx) + 4 * PX;
  const dateWidth = Math.max(90 * PX, textWidth(birthDate, fieldPx) + 12 * PX);
  const placeLeft = dateLeft + dateWidth + 4 * PX;
  const noteWidth = textWidth(note, 10);
  const placeWidth = right - noteWidth - 4 * PX - placeLeft;

  setText(fieldPx);
  doc.text("BIRTH:", MARGIN, birthBaseline);
  doc.text(birthDate, dateLeft + 6 * PX, birthBaseline);
  doc.text(doc.splitTextToSize(birthPlace, placeWidth - 12 * PX)[0] || "", placeLeft + 6 * PX, birthBaseline);
  rule(dateLeft, dateLeft + dateWidth, birthUnderline);
  rule(placeLeft, placeLeft + placeWidth, birthUnderline);
  setText(10);
  doc.text(note, right - noteWidth, birthBaseline);
  y = birthUnderline + PX / 2;

  let captionLeft = MARGIN + 62 * PX;
  [["(Date)", "italic"], ["(Place)", "italic"], ["birth certificates or other reliable records)", "normal"]].forEach(
    ([caption, style]) => {
      setText(10, style);
      doc.text(caption, captionLeft, baselineOf(y, 10));
      captionLeft += doc.getTextWidth(caption) + 34 * PX;
    }
  );
  y += lineBox(10) + 14 * PX;

  // Certification, justified.
  setText(fieldPx);
  const certification = doc.splitTextToSize(CERTIFICATION, contentWidth);
  doc.text(certification, MARGIN, baselineOf(y, fieldPx, 1.5), {
    align: "justify",
    maxWidth: contentWidth,
    lineHeightFactor: 1.5,
  });
  y += certification.length * lineBox(fieldPx, 1.5) + 10 * PX;

  // The appointment table, built from the same cells as the print.
  const rows = serviceRecordTableRows(records).map((cells) => [...cells.slice(0, 8), cells[8].join("\n")]);
  const columnStyles = Object.fromEntries(
    SERVICE_RECORD_COLUMN_WIDTHS.map((percent, index) => [index, { cellWidth: (percent / 100) * contentWidth }])
  );
  columnStyles[4].halign = "right";
  columnStyles[8].halign = "left";

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
    tableWidth: contentWidth,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: fontPt(10.5),
      textColor: 0,
      lineColor: 0,
      lineWidth: PX,
      cellPadding: { top: 3 * PX, bottom: 3 * PX, left: 4 * PX, right: 4 * PX },
      overflow: "linebreak",
      halign: "center",
      valign: "top",
    },
    headStyles: {
      fillColor: false,
      textColor: 0,
      fontStyle: "bold",
      fontSize: fontPt(9),
      halign: "center",
      valign: "middle",
      cellPadding: { top: 3 * PX, bottom: 3 * PX, left: 2 * PX, right: 2 * PX },
    },
    columnStyles,
    rowPageBreak: "avoid",
    head: [
      [
        { content: "SERVICE\n(Inclusive Date)", colSpan: 2 },
        { content: "RECORD OF APPOINTMENT", colSpan: 3 },
        { content: "OFFICE", colSpan: 2 },
        { content: "LEAVE OF\nABSENCE\nW/O PAY", rowSpan: 2 },
        { content: "SEPARATION\nDATE/CAUSE\nREMARKS", rowSpan: 2 },
      ],
      ["FROM", "TO", "DESIGNATION", "STATUS", "SALARY\n/ANNUM", "STATION/PLACE\nOF ASSIGNMENT", "BRANCH"],
    ],
    body: rows.length ? rows : [[{ content: "No service record entries.", colSpan: 9 }]],
  });

  // Issued note, date, and the certifying signature, kept together on one page.
  const issuedLines = emphasisLines(doc, ISSUED, 11, contentWidth);
  const closingHeight = 12 * PX + issuedLines.length * lineBox(11, 1.5) + 14 * PX + lineBox(fieldPx)
    + 26 * PX + lineBox(11) + 11 * PX + 44 * PX + PX + lineBox(11) * 3;
  y = doc.lastAutoTable.finalY;
  if (y + closingHeight > height - MARGIN) {
    doc.addPage();
    y = MARGIN;
  } else {
    y += 12 * PX;
  }

  setText(11);
  issuedLines.forEach((line, index) => {
    const lineBaseline = baselineOf(y + index * lineBox(11, 1.5), 11, 1.5);
    let cursor = MARGIN;
    line.forEach(({ text, emphasis, width: pieceWidth }) => {
      setText(11, emphasis ? "italic" : "normal");
      doc.text(text, cursor, lineBaseline);
      if (emphasis) {
        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        doc.line(cursor, lineBaseline + 0.35, cursor + pieceWidth, lineBaseline + 0.35);
      }
      cursor += pieceWidth;
    });
  });
  y += issuedLines.length * lineBox(11, 1.5) + 14 * PX;

  setText(fieldPx, "bold");
  doc.text(`Date: ${formatServiceDate(new Date().toLocaleDateString("en-CA"))}`, MARGIN, baselineOf(y, fieldPx));
  y += lineBox(fieldPx) + 26 * PX;

  const signWidth = 300 * PX;
  const signLeft = right - signWidth;
  const signCenter = signLeft + signWidth / 2;
  setText(11, "italic");
  doc.text("Certified Correct", signCenter, baselineOf(y, 11), { align: "center" });
  y += lineBox(11) + 11 * PX;

  const inkHeight = 44 * PX;
  if (signatureDataUrl) {
    const image = doc.getImageProperties(signatureDataUrl);
    const scale = Math.min((240 * PX) / image.width, inkHeight / image.height);
    const inkWidth = image.width * scale;
    const inkTall = image.height * scale;
    doc.addImage(signatureDataUrl, image.fileType, signCenter - inkWidth / 2, y + inkHeight - inkTall, inkWidth, inkTall);
  }
  y += inkHeight;
  rule(signLeft, right, y + PX / 2);
  y += PX;

  setText(11, "bold");
  doc.splitTextToSize(certifiedBy || "", signWidth).filter(Boolean).forEach((line) => {
    doc.text(line, signCenter, baselineOf(y, 11), { align: "center" });
    y += lineBox(11);
  });
  setText(11, "italic");
  doc.text("Human Resource Management Officer", signCenter, baselineOf(y, 11), { align: "center" });

  // Page numbers only when the form runs past one page.
  const pageCount = doc.getNumberOfPages();
  if (pageCount > 1) {
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      setText(9, "normal", "helvetica");
      doc.text(`Page ${page} of ${pageCount}`, width / 2, height - 5, { align: "center" });
    }
  }

  return doc;
}

async function loadLogo(path) {
  try {
    const response = await fetch(`${process.env.PUBLIC_URL || ""}${path}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function downloadServiceRecordPdf(options) {
  const logos = await Promise.all([loadLogo("/mgb.png"), loadLogo("/bagongpilipinas.png")]);
  const doc = buildServiceRecordPdf({ ...options, logos });
  const name = String(options.employee.employeeCode || options.employee.fullName || "employee").replace(/[^a-z0-9_-]+/gi, "-");
  doc.save(`Service-Record-${name}.pdf`);
}
