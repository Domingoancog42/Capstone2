import React, { forwardRef, useRef } from "react";
import { X } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { formatDate, formatPeriod } from "./awardCycleUtils";

/**
 * The certificate a closed award cycle mints for its winner: the paper itself, the overlay that
 * previews it, and the PDF export both the preview and the My Awards table download through.
 *
 * `rewards.php` issues the record — everything here renders what it already decided, so a certificate
 * looks the same in the browser, in the print dialog, and in the downloaded file. The paper is styled
 * entirely with inline styles rather than Tailwind classes for exactly that reason: html2canvas and a
 * fresh print window both see the finished styling without the stylesheet coming along.
 */

const certificateStyles = {
  paper: {
    fontFamily: "Georgia, 'Times New Roman', serif",
    width: "100%",
    maxWidth: "920px",
    margin: "0 auto",
    background: "#ffffff",
    border: "2px solid #b08d3f",
    padding: "10px",
    color: "#111827",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  frame: {
    border: "1px solid #d8c48a",
    padding: "22px 34px 26px",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "70px 1fr 70px",
    alignItems: "center",
    gap: "10px",
  },
  logoImage: {
    width: "64px",
    height: "64px",
    objectFit: "contain",
    display: "block",
  },
  headerText: {
    textAlign: "center",
    fontFamily: "Arial, Helvetica, sans-serif",
    lineHeight: 1.5,
  },
  bar: {
    backgroundColor: "#f5c518",
    height: "5px",
    margin: "10px 0 0",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  title: {
    textAlign: "center",
    margin: "26px 0 0",
    letterSpacing: "7px",
    fontSize: "24px",
    fontWeight: "bold",
  },
  lead: {
    textAlign: "center",
    margin: "16px 0 0",
    fontSize: "12.5px",
    fontStyle: "italic",
    color: "#4b5563",
  },
  name: {
    textAlign: "center",
    margin: "10px 0 0",
    fontSize: "30px",
    fontWeight: "bold",
    letterSpacing: "1px",
    borderBottom: "1px solid #9ca3af",
    paddingBottom: "8px",
  },
  jobLine: {
    textAlign: "center",
    margin: "8px 0 0",
    fontSize: "11.5px",
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "#4b5563",
  },
  body: {
    textAlign: "center",
    margin: "20px auto 0",
    maxWidth: "620px",
    fontSize: "13px",
    lineHeight: 1.9,
  },
  award: {
    display: "block",
    margin: "6px 0",
    fontSize: "17px",
    fontWeight: "bold",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
  },
  given: {
    textAlign: "center",
    margin: "22px auto 0",
    maxWidth: "620px",
    fontSize: "12px",
    lineHeight: 1.8,
    color: "#374151",
  },
  signatureBlock: {
    margin: "34px 0 0",
    display: "flex",
    justifyContent: "flex-end",
  },
  signature: {
    textAlign: "center",
    minWidth: "260px",
  },
  signatureName: {
    margin: 0,
    paddingTop: "6px",
    borderTop: "1px solid #111827",
    fontSize: "13px",
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  signatureTitle: {
    margin: "3px 0 0",
    fontSize: "11px",
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "#4b5563",
  },
  footer: {
    margin: "26px 0 0",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "8px",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "10px",
    color: "#6b7280",
  },
};

/** "4th day of August 2026" — the wording a printed certificate is expected to carry. */
function formatGivenDate(value) {
  const parsed = new Date(`${String(value || "").slice(0, 10)}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const day = parsed.getDate();
  const remainder = day % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");

  const month = parsed.toLocaleDateString("en-PH", { month: "long" });

  return `${day}${suffix} day of ${month} ${parsed.getFullYear()}`;
}

export function certificateFileName(certificate) {
  const number = String(certificate?.certificateNumber || "certificate").replace(/[^A-Za-z0-9-]+/g, "-");
  return `Certificate-${number}.pdf`;
}

/** html2canvas paints whatever is on screen, so a logo still loading would land as a blank box. */
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
 * The certificate as a one-page landscape A4 PDF.
 *
 * Scaled by whichever axis runs out first rather than by width alone: a certificate that spilled onto
 * a second page would be a certificate nobody can hand over.
 */
export async function exportCertificatePdf(node, fileName) {
  if (!node) {
    throw new Error("The certificate is not ready yet.");
  }

  await waitForImages(node);

  const canvas = await html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  const pdf = new jsPDF("l", "mm", "a4");
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
    (pageHeight - height) / 2,
    width,
    height,
  );
  pdf.save(fileName);
}

/** Opens the print dialog on a copy of the paper. Inline styles travel with the clone. */
export function printCertificate(node) {
  if (!node) {
    return;
  }

  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) {
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Award Certificate</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          html, body { margin: 0; padding: 0; background: #ffffff; }
          *, *::before, *::after {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-shell { width: 100%; max-width: 275mm; margin: 0 auto; }
        </style>
      </head>
      <body><div class="print-shell">${node.outerHTML}</div></body>
    </html>
  `);
  printWindow.document.close();

  const finish = () => {
    printWindow.focus();
    printWindow.print();
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
  };

  waitForImages(printWindow.document).then(() => window.setTimeout(finish, 150));
}

export const AwardCertificatePaper = forwardRef(function AwardCertificatePaper({ certificate }, ref) {
  if (!certificate) {
    return null;
  }

  const period = formatPeriod(certificate);
  const jobLine = [certificate.designationTitle, certificate.divisionName].filter(Boolean).join(" · ");
  const givenDate = formatGivenDate(certificate.awardedOn);

  return (
    <div ref={ref} style={certificateStyles.paper}>
      <div style={certificateStyles.frame}>
        <div style={certificateStyles.header}>
          <img src="/mgb.png" alt="MGB Logo" style={certificateStyles.logoImage} />

          <div style={certificateStyles.headerText}>
            <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Republic of the Philippines</p>
            <p style={{ margin: "1px 0", fontSize: "9.5px" }}>Department of Environment and Natural Resources</p>
            <p style={{ margin: "1px 0", fontSize: "13.5px", fontWeight: "bold" }}>MINES AND GEOSCIENCES BUREAU</p>
            <p style={{ margin: "1px 0", fontSize: "10px", fontWeight: "bold" }}>Regional Office No. X</p>
            <p style={{ margin: "1px 0", fontSize: "8.5px" }}>DENR-X Compound, Puntod, Cagayan de Oro City</p>
          </div>

          <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={certificateStyles.logoImage} />
        </div>

        <div style={certificateStyles.bar} />

        <div style={certificateStyles.title}>CERTIFICATE OF RECOGNITION</div>
        <p style={certificateStyles.lead}>is hereby awarded to</p>

        <p style={certificateStyles.name}>{certificate.employeeName || "—"}</p>
        {jobLine ? <p style={certificateStyles.jobLine}>{jobLine}</p> : null}

        <p style={certificateStyles.body}>
          for having been chosen by peers as
          <span style={certificateStyles.award}>{certificate.awardTitle}</span>
          {period ? `for the nomination period ${period}.` : "of this nomination cycle."}
        </p>

        {givenDate ? (
          <p style={certificateStyles.given}>
            Given this {givenDate} at the Mines and Geosciences Bureau, Regional Office No. X,
            DENR-X Compound, Puntod, Cagayan de Oro City.
          </p>
        ) : null}

        <div style={certificateStyles.signatureBlock}>
          <div style={certificateStyles.signature}>
            <p style={certificateStyles.signatureName}>{certificate.signatoryName || " "}</p>
            <p style={certificateStyles.signatureTitle}>
              {certificate.signatoryTitle || "OIC Regional Executive Director"}
            </p>
          </div>
        </div>

        <div style={certificateStyles.footer}>
          <span>Certificate No. {certificate.certificateNumber || "—"}</span>
          <span>Awarded {formatDate(certificate.awardedOn) || "—"}</span>
        </div>
      </div>
    </div>
  );
});

/**
 * The preview overlay, matching the travel order form preview: the paper on a grey mat with the
 * actions in the header, so a certificate is read the same way every other document in the app is.
 */
export default function AwardCertificateModal({
  open = false,
  certificate = null,
  downloading = false,
  onDownload,
  onClose,
}) {
  const paperRef = useRef(null);

  if (!open || !certificate) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close certificate preview"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-4">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-lg font-semibold text-slate-950">{certificate.awardTitle}</h2>
            <p className="m-0 mt-1 text-sm text-slate-500">
              Certificate No. {certificate.certificateNumber || "—"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => printCertificate(paperRef.current)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Print
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => onDownload?.(paperRef.current)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading ? "Preparing..." : "Download PDF"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close certificate preview"
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-slate-100 px-3 py-4 sm:px-4">
          <AwardCertificatePaper ref={paperRef} certificate={certificate} />
        </div>
      </div>
    </div>
  );
}
