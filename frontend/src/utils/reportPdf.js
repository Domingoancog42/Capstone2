import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { ORGANIZATION_NAME, ORGANIZATION_SUBTITLE, ORGANIZATION_LOGO, reportPrintColumns } from "../module/reports/reportDocument";

async function loadReportLogo() {
  const response = await fetch(ORGANIZATION_LOGO);
  if (!response.ok) throw new Error("Unable to load the report letterhead logo.");
  return new Uint8Array(await response.arrayBuffer());
}

/** The same letterhead, visible columns and ruled table used by the report Print button. */
export async function buildReportPdf(report, {
  logo,
  generatedAt = new Date(),
  pageTitle = typeof document === "undefined" ? "Human Resource Information System" : document.title,
  pageUrl = typeof window === "undefined" ? "" : `${window.location.host}${window.location.pathname}`,
} = {}) {
  const landscape = report.key === "payroll-deductions";
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const margin = 12;
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const columns = reportPrintColumns(report);
  if (!columns.length) throw new Error("This report has no printable columns.");
  const ink = [15, 23, 42];
  pdf.setTextColor(...ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  const name = ORGANIZATION_NAME.toUpperCase();
  const sealSize = 34.4;
  const gap = 5.3;
  const groupWidth = sealSize + gap + pdf.getTextWidth(name);
  const logoX = (width - groupWidth) / 2;
  pdf.addImage(logo || await loadReportLogo(), "PNG", logoX, margin, sealSize, sealSize);
  const textX = logoX + sealSize + gap;
  pdf.text(name, textX, margin + 15);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(ORGANIZATION_SUBTITLE, textX, margin + 21);
  pdf.setTextColor(...ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13.5);
  const titleLines = pdf.splitTextToSize(String(report.label || "Report").toUpperCase(), width - margin * 2);
  pdf.text(titleLines, width / 2, margin + sealSize + 7, { align: "center" });
  let y = margin + sealSize + 11 + (titleLines.length - 1) * 5;
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.2);
  pdf.line(margin, y, width - margin, y);
  const appliedFilters = report.appliedFilters || [];
  const filters = (Array.isArray(appliedFilters)
    ? appliedFilters.map((filter) => `${filter.label}: ${filter.value}`)
    : Object.entries(appliedFilters).map(([key, value]) => `${key}: ${value}`)
  ).join("    ");
  if (filters) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(filters, width - margin * 2);
    pdf.text(lines, margin, y + 6);
    y += lines.length * 4 + 5;
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.text("Report Data", margin, y + 11);
  const rows = report.rows || [];
  const tableOptions = {
    startY: y + 16,
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    tableWidth: width - margin * 2,
    theme: "grid",
    head: [columns.map((column) => String(column.label).toUpperCase())],
    body: rows.length ? rows.map((row) => columns.map((column) => String(row[column.key] ?? "N/A"))) : [[{
      content: "No records found for the selected filters.", colSpan: columns.length,
      styles: { halign: "center" },
    }]],
    styles: {
      font: "helvetica", fontSize: landscape ? 3.2 : 9.5, textColor: ink, overflow: "linebreak",
      cellWidth: landscape ? (width - margin * 2 - 56) / Math.max(1, columns.length - 4) : (width - margin * 2) / columns.length,
      cellPadding: landscape ? 0.25 : { top: 1.3, bottom: 1.3, left: 2.1, right: 2.1 },
      lineColor: [148, 163, 184], lineWidth: landscape ? 0.1 : 0.2,
    },
    headStyles: { fontStyle: "bold", fillColor: [255, 255, 255], textColor: ink, lineColor: [51, 65, 85] },
    bodyStyles: { fillColor: [255, 255, 255] },
    rowPageBreak: "avoid",
    showHead: "everyPage",
  };
  if (landscape) {
    tableOptions.columnStyles = { 0: { cellWidth: 9 }, 1: { cellWidth: 26 }, 2: { cellWidth: 9 }, 3: { cellWidth: 12 } };
    tableOptions.body = rows.length ? rows.map((row) => columns.map((column) => (
      column.key.startsWith("amount_") ? Number(row[column.key] || 0).toFixed(2) : String(row[column.key] ?? "N/A")
    ))) : tableOptions.body;
    // Measure with the actual PDF table renderer, then reduce text and padding until
    // every employee fits. No rows or columns are clipped to enforce the one-page layout.
    let fitted = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const measurement = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      autoTable(measurement, tableOptions);
      if (measurement.getNumberOfPages() === 1) {
        fitted = true;
        break;
      }
      tableOptions.styles.fontSize *= 0.8;
      tableOptions.styles.cellPadding *= 0.8;
    }
    if (!fitted) throw new Error("Unable to fit this payroll deduction report on one page.");
  }
  autoTable(pdf, tableOptions);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...ink);
    pdf.text(generatedAt.toLocaleString(), 8, 6);
    pdf.text(pdf.splitTextToSize(pageTitle, width - 80)[0] || "", width / 2, 6, { align: "center" });
    pdf.text(pdf.splitTextToSize(pageUrl, width - 35)[0] || "", 8, height - 5);
    pdf.text(`${page}/${pages}`, width - 8, height - 5, { align: "right" });
  }
  return pdf;
}
