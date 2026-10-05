import React, { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { faPrint } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  isPassSlipQrActive,
  passSlipNextScanLabel,
  passSlipStatusBadgeClasses,
  passSlipStatusLabel,
} from "../../utils/passSlipStatus";

/*
 * The pass slip's QR code, as the employee sees it before walking out.
 *
 * The code carries the slip's token and nothing else -- no name, no employee number, no dates. That
 * is deliberate and is the difference between this and the QR blocks on the leave and travel forms:
 * those print the record so a reader with no system access can still read it, whereas this one *is*
 * a credential. Anything legible encoded beside the token would be personal data handed to whoever
 * photographs the badge, and it would buy nothing, because only the HRIS can act on the code anyway.
 */

/* Level M, not the L the printed forms use: this payload is 40 characters, so the stronger recovery
 * level costs no extra QR version at all, and a code that is scanned off a creased printout or a
 * phone screen at a gate has more to recover from than one read off a clean office laser print. */
const QR_ERROR_CORRECTION = "M";

function PassSlipQrCard({ record, size = 208, muted = false }) {
  const value = String(record?.qrValue || "");

  if (!value) {
    return (
      <div className="grid h-[208px] w-[208px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-500">
        No QR code yet
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${muted ? "opacity-45 grayscale" : ""}`}
      style={{ lineHeight: 0 }}
    >
      <QRCodeSVG
        value={value}
        size={size}
        level={QR_ERROR_CORRECTION}
        bgColor="#ffffff"
        fgColor="#0f172a"
        marginSize={0}
      />
    </div>
  );
}

/**
 * Open a print window holding just the QR badge.
 *
 * The badge is rebuilt from the record rather than cloned out of the page, because the on-screen
 * card is a Tailwind component whose classes mean nothing in a blank window. Inline styles travel;
 * a stylesheet reference would not.
 */
function printQrBadge(node) {
  if (!node) return;

  const printWindow = window.open("", "_blank", "width=520,height=680");
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Pass Slip QR Code</title>
        <style>
          @page { size: auto; margin: 12mm; }
          html, body { margin: 0; padding: 0; background: #ffffff; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #0f172a;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        </style>
      </head>
      <body>${node.outerHTML}</body>
    </html>
  `);
  printWindow.document.close();

  const finish = () => {
    printWindow.focus();
    printWindow.print();
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
  };

  window.setTimeout(finish, 200);
}

/** The standalone badge that gets printed: QR, reference, owner, and what the code is for. */
function PassSlipQrBadge({ record, badgeRef }) {
  const styles = {
    badge: {
      width: "72mm",
      border: "2px solid #0f172a",
      borderRadius: "6px",
      padding: "10px 12px 12px",
      textAlign: "center",
      margin: "0 auto",
    },
    agency: { fontSize: "8px", letterSpacing: "0.5px", margin: "0 0 2px", textTransform: "uppercase" },
    title: { fontSize: "13px", fontWeight: 900, letterSpacing: "2px", margin: "0 0 6px", textTransform: "uppercase" },
    reference: { fontSize: "12px", fontWeight: "bold", margin: "8px 0 2px", letterSpacing: "1px" },
    name: { fontSize: "11px", fontWeight: "bold", margin: "0 0 1px" },
    meta: { fontSize: "8.5px", color: "#334155", margin: "0" },
    note: { fontSize: "7.5px", color: "#334155", marginTop: "6px", lineHeight: 1.35 },
  };

  return (
    <div ref={badgeRef} style={styles.badge}>
      <p style={styles.agency}>Mines and Geosciences Bureau — Region X</p>
      <p style={styles.title}>Pass Slip</p>
      <QRCodeSVG
        value={String(record?.qrValue || "")}
        size={150}
        level={QR_ERROR_CORRECTION}
        bgColor="#ffffff"
        fgColor="#000000"
        marginSize={1}
      />
      <p style={styles.reference}>{record?.reference || ""}</p>
      <p style={styles.name}>{record?.employeeName || ""}</p>
      <p style={styles.meta}>
        {[record?.employeeId, record?.position, record?.division].filter(Boolean).join(" • ")}
      </p>
      <p style={styles.note}>
        Scan on the way out to record Time Out, and again on return to record Time Returned.
      </p>
    </div>
  );
}

export default function PassSlipQrPanel({ record, size = 208, showPrint = true }) {
  const badgeRef = useRef(null);

  if (!record) return null;

  const active = isPassSlipQrActive(record);

  return (
    <div className="flex flex-col items-center gap-3">
      <PassSlipQrCard record={record} size={size} muted={!active} />

      <div className="text-center">
        <p className="m-0 font-mono text-sm font-bold tracking-[0.12em] text-slate-900">
          {record.reference}
        </p>
        <span
          className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${passSlipStatusBadgeClasses(record.status)}`}
        >
          {passSlipStatusLabel(record.status)}
        </span>
        <p className={`m-0 mt-2 max-w-[260px] text-xs ${active ? "text-slate-600" : "text-slate-500"}`}>
          {passSlipNextScanLabel(record)}
        </p>
      </div>

      {showPrint ? (
        <button
          type="button"
          onClick={() => printQrBadge(badgeRef.current)}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <FontAwesomeIcon icon={faPrint} />
          Print QR badge
        </button>
      ) : null}

      {/* Kept off-screen so the print window has a laid-out node to serialize on demand. */}
      <div className="pointer-events-none fixed -left-[10000px] top-0 opacity-0" aria-hidden="true">
        <PassSlipQrBadge record={record} badgeRef={badgeRef} />
      </div>
    </div>
  );
}

export { PassSlipQrCard };
