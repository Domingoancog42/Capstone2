import React from "react";
import { QRCodeSVG } from "qrcode.react";

/*
 * QR block stamped on the printable leave and travel order forms.
 *
 * The SVG renderer is deliberate: both print flows clone the form node and hand its `outerHTML` to a
 * new window, and a canvas would arrive blank because its pixels are not part of the serialized
 * markup. An inline SVG carries its own paths across intact.
 */
const styles = {
  block: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  frame: {
    /*
     * The quiet zone is part of the spec -- without a white margin a scanner can fail to lock onto
     * the finder patterns. It lives here as padding rather than as the component's `marginSize` so
     * the modules keep the full rendered size instead of giving four rows of it back to the border.
     */
    background: "#ffffff",
    padding: "6px",
    border: "1px solid #cbd5e1",
    lineHeight: 0,
  },
  caption: {
    fontSize: "7px",
    lineHeight: 1.3,
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    fontWeight: "bold",
  },
  reference: {
    fontSize: "7.5px",
    lineHeight: 1.3,
    color: "#111827",
    fontWeight: "bold",
  },
};

export default function FormQrCode({
  value = "",
  size = 104,
  align = "left",
  caption = "Scan to view record",
  reference = "",
}) {
  if (!String(value || "").trim()) {
    return null;
  }

  const alignItems = align === "right" ? "flex-end" : "flex-start";
  const textAlign = align === "right" ? "right" : "left";

  return (
    <div style={{ ...styles.block, alignItems }}>
      <div style={styles.frame}>
        {/*
          * Level L, not the usual M: these payloads carry the whole record, and the extra recovery
          * data of M costs two QR versions -- shrinking the printed modules below what a phone
          * camera resolves. A clean laser print does not need that much redundancy. `boostLevel`
          * is on by default, so shorter records still get a stronger level for free.
          */}
        <QRCodeSVG
          value={value}
          size={size}
          level="L"
          bgColor="#ffffff"
          fgColor="#000000"
          marginSize={0}
        />
      </div>
      {reference ? <div style={{ ...styles.reference, textAlign }}>{reference}</div> : null}
      {caption ? <div style={{ ...styles.caption, textAlign }}>{caption}</div> : null}
    </div>
  );
}
