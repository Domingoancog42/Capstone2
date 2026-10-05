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
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#cbd5e1",
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

/*
 * A centre logo hides the modules under it, so a QR with a logo is drawn at level M (about 15% of
 * its codewords recoverable) instead of L (about 7%). With the MGB emblem
 * (MGB-Logo-remove-background.png) on the 118px leave QR, jsQR decoded 53 leave payloads of
 * 155-365 characters at several sizes and blurs: at level M every one at 38% of the width and
 * some failed at 42%; at level L the limit was 32%. Level Q fared worse than M, as its modules
 * got too small. The limit depends on the QR version, so test short payloads as well as long
 * ones before raising it. On the 124px travel order QR (payloads of 237-498 characters), logos
 * from 30% to 40% decoded exactly as the same code without a logo did.
 */
const LOGO_WIDTH_RATIO = 0.38;

export default function FormQrCode({
  value = "",
  size = 104,
  align = "left",
  caption = "Scan to view record",
  reference = "",
  showBorder = true,
  /*
   * The logo's opaque pixels cover the modules beneath it. The modules are not excavated, so a
   * logo with a transparent background sits on the code without a white box, and the modules
   * show through any transparent gaps inside it.
   */
  logoSrc = "",
  // Width / height of the logo image; qrcode.react stretches the image to the box it is given.
  logoAspectRatio = 1,
}) {
  if (!String(value || "").trim()) {
    return null;
  }

  const alignItems = align === "right" ? "flex-end" : "flex-start";
  const textAlign = align === "right" ? "right" : "left";
  const logoWidth = Math.round(size * LOGO_WIDTH_RATIO);
  const imageSettings = logoSrc
    ? {
      src: logoSrc,
      width: logoWidth,
      height: Math.round(logoWidth / logoAspectRatio),
      excavate: false,
    }
    : undefined;

  return (
    <div style={{ ...styles.block, alignItems }}>
      <div style={{ ...styles.frame, borderWidth: showBorder ? styles.frame.borderWidth : "0px" }}>
        {/*
          * Level L, not the usual M: these payloads carry the whole record, and the extra recovery
          * data of M costs two QR versions -- shrinking the printed modules below what a phone
          * camera resolves. A clean laser print does not need that much redundancy. `boostLevel`
          * is on by default, so shorter records still get a stronger level for free. A logo needs
          * the extra recovery, so it takes M and its smaller modules (0.30mm printed at worst on
          * the leave form, against 0.36mm at L).
          */}
        <QRCodeSVG
          value={value}
          size={size}
          level={logoSrc ? "M" : "L"}
          bgColor="#ffffff"
          fgColor="#000000"
          marginSize={0}
          imageSettings={imageSettings}
        />
      </div>
      {reference ? <div style={{ ...styles.reference, textAlign }}>{reference}</div> : null}
      {caption ? <div style={{ ...styles.caption, textAlign }}>{caption}</div> : null}
    </div>
  );
}
