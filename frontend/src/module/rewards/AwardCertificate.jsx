import React, { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { formatDate, formatPeriod } from "./awardCycleUtils";
import {
  CERTIFICATE_ELEMENT_DEFINITIONS,
  CERTIFICATE_HEIGHT,
  CERTIFICATE_WIDTH,
  normalizeCertificateTemplate,
} from "./certificateTemplate";
import { resolveBackendAssetUrl } from "../../utils/backendAssetUrl";

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

/** Export the exact visual canvas as a one-page landscape A4 PDF. */
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

/** Opens the print dialog on a copy of the fully styled paper. */
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
          .print-shell { width: 960px; max-width: 100%; margin: 0 auto; }
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

function CertificateBackdrop({ template }) {
  const { preset, paper } = template;

  if (preset === "emerald") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: 9, border: `6px solid ${paper.primaryColor}` }} />
        <div style={{ position: "absolute", inset: 20, border: `1px solid ${paper.accentColor}` }} />
        <div style={{ position: "absolute", left: 31, top: 31, width: 25, height: 25, border: `2px solid ${paper.accentColor}`, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", right: 31, bottom: 31, width: 25, height: 25, border: `2px solid ${paper.accentColor}`, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", left: 105, right: 105, top: 152, height: 2, background: paper.accentColor }} />
        <div style={{ position: "absolute", left: 150, right: 150, top: 322, height: 1, background: `${paper.primaryColor}55` }} />
      </>
    );
  }

  if (preset === "burgundy") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: "0 0 auto", height: 132, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: "132px 0 auto", height: 7, background: paper.accentColor }} />
        <div style={{ position: "absolute", inset: 12, border: `1px solid ${paper.accentColor}` }} />
        <div style={{ position: "absolute", left: -48, top: 104, width: 180, height: 18, background: paper.accentColor, transform: "rotate(-35deg)", opacity: 0.75 }} />
        <div style={{ position: "absolute", right: -48, top: 104, width: 180, height: 18, background: paper.accentColor, transform: "rotate(35deg)", opacity: 0.75 }} />
        <div style={{ position: "absolute", left: 105, right: 105, top: 320, height: 1, background: `${paper.primaryColor}40` }} />
        <div style={{ position: "absolute", left: 98, right: 98, bottom: 46, height: 3, background: paper.primaryColor }} />
      </>
    );
  }

  if (preset === "minimal") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: 24, border: `1px solid ${paper.primaryColor}40` }} />
        <div style={{ position: "absolute", left: 75, right: 75, top: 151, height: 1, background: paper.accentColor }} />
        <div style={{ position: "absolute", left: "50%", top: 145, width: 13, height: 13, background: paper.backgroundColor, border: `1px solid ${paper.accentColor}`, transform: "translateX(-50%) rotate(45deg)" }} />
        <div style={{ position: "absolute", left: 108, right: 108, top: 331, height: 1, background: `${paper.primaryColor}18` }} />
        <div style={{ position: "absolute", left: 75, right: 75, bottom: 45, height: 1, background: `${paper.primaryColor}30` }} />
      </>
    );
  }

  if (preset === "geometric") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: "0 auto 0 0", width: 26, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: "0 0 auto 26px", height: 10, background: paper.accentColor }} />
        <div style={{ position: "absolute", right: -120, top: -135, width: 300, height: 300, background: `${paper.primaryColor}12`, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", right: 36, top: 151, width: 94, height: 12, background: paper.accentColor }} />
        <div style={{ position: "absolute", left: 116, top: 326, width: 105, height: 5, background: paper.primaryColor }} />
        <div style={{ position: "absolute", left: 116, right: 80, bottom: 43, height: 2, background: paper.accentColor }} />
        <div style={{ position: "absolute", right: -45, bottom: 74, width: 150, height: 16, background: `${paper.primaryColor}20`, transform: "rotate(-45deg)" }} />
      </>
    );
  }

  if (preset === "ceremonial") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: "0 0 auto", height: 130, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: "130px 0 auto", height: 9, background: paper.accentColor }} />
        <div style={{ position: "absolute", inset: 10, border: `3px solid ${paper.primaryColor}` }} />
        <div style={{ position: "absolute", inset: 18, border: `1px solid ${paper.accentColor}` }} />
        <div style={{ position: "absolute", left: "50%", top: 299, width: 280, height: 280, borderRadius: "50%", border: `34px solid ${paper.primaryColor}08`, transform: "translate(-50%, -50%)" }} />
        <div style={{ position: "absolute", left: 105, right: 105, top: 319, height: 1, background: `${paper.accentColor}90` }} />
        <div style={{ position: "absolute", left: 96, right: 96, bottom: 46, height: 3, background: paper.accentColor }} />
      </>
    );
  }

  if (preset === "academic") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: "0 auto 0 0", width: 16, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: "0 0 0 auto", width: 16, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: 25, border: `2px solid ${paper.primaryColor}` }} />
        <div style={{ position: "absolute", inset: 33, border: `1px solid ${paper.accentColor}` }} />
        <div style={{ position: "absolute", left: 150, right: 150, top: 145, height: 18, borderRadius: "50%", background: `${paper.accentColor}25` }} />
        <div style={{ position: "absolute", left: 115, right: 115, top: 323, height: 1, background: `${paper.primaryColor}55` }} />
        <div style={{ position: "absolute", left: 145, right: 145, bottom: 45, height: 2, background: paper.primaryColor }} />
      </>
    );
  }

  if (preset === "sunrise") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${paper.backgroundColor} 0%, #ffffff 55%, ${paper.accentColor}12 100%)` }} />
        <div style={{ position: "absolute", inset: "0 0 auto", height: 11, background: paper.accentColor }} />
        <div style={{ position: "absolute", inset: 20, border: `2px solid ${paper.primaryColor}` }} />
        <div style={{ position: "absolute", left: -105, bottom: -120, width: 330, height: 330, borderRadius: "50%", border: `48px solid ${paper.accentColor}20` }} />
        <div style={{ position: "absolute", right: -145, top: -155, width: 350, height: 350, borderRadius: "50%", border: `55px solid ${paper.primaryColor}10` }} />
        <div style={{ position: "absolute", left: 115, right: 115, top: 151, height: 4, background: paper.accentColor }} />
        <div style={{ position: "absolute", left: 130, right: 130, top: 326, height: 1, background: `${paper.primaryColor}50` }} />
      </>
    );
  }

  if (preset === "modern") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: "0 auto 0 0", width: 25, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: "0 0 auto 25px", height: 8, background: paper.accentColor }} />
        <div style={{ position: "absolute", right: -65, top: -70, width: 235, height: 235, borderRadius: "50%", border: `42px solid ${paper.primaryColor}12` }} />
        <div style={{ position: "absolute", left: 116, top: 325, width: 80, height: 4, borderRadius: 4, background: paper.accentColor }} />
        <div style={{ position: "absolute", left: 116, right: 82, bottom: 43, height: 1, background: `${paper.primaryColor}25` }} />
      </>
    );
  }

  if (preset === "executive") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
        <div style={{ position: "absolute", inset: "0 0 auto", height: 132, background: paper.primaryColor }} />
        <div style={{ position: "absolute", inset: "132px 0 auto", height: 7, background: paper.accentColor }} />
        <div style={{ position: "absolute", inset: 12, border: `1px solid ${paper.accentColor}`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: 94, right: 94, top: 318, height: 1, background: `${paper.accentColor}85` }} />
        <div style={{ position: "absolute", left: 98, right: 98, bottom: 47, height: 1, background: `${paper.primaryColor}25` }} />
      </>
    );
  }

  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: paper.backgroundColor }} />
      <div style={{ position: "absolute", inset: 10, border: `3px solid ${paper.primaryColor}` }} />
      <div style={{ position: "absolute", inset: 18, border: `1px solid ${paper.accentColor}` }} />
      <div style={{ position: "absolute", left: 42, right: 42, top: 145, height: 5, background: paper.accentColor }} />
      <div style={{ position: "absolute", left: 100, right: 100, top: 322, height: 1, background: `${paper.primaryColor}55` }} />
      <div style={{ position: "absolute", left: 46, top: 46, width: 56, height: 56, borderLeft: `3px solid ${paper.accentColor}`, borderTop: `3px solid ${paper.accentColor}` }} />
      <div style={{ position: "absolute", right: 46, bottom: 46, width: 56, height: 56, borderRight: `3px solid ${paper.accentColor}`, borderBottom: `3px solid ${paper.accentColor}` }} />
    </>
  );
}

function certificateContentFor(id, certificate, template) {
  const period = formatPeriod(certificate);
  const jobLine = [certificate?.designationTitle, certificate?.divisionName].filter(Boolean).join(" · ");
  const givenDate = formatGivenDate(certificate?.awardedOn);

  switch (id) {
    case "organization":
    case "title":
    case "lead":
    case "message":
    case "closing":
      return template.text[id] || "";
    case "recipient":
      return certificate?.employeeName || "—";
    case "job":
      return jobLine;
    case "award":
      return certificate?.awardTitle || "Award Name";
    case "period":
      return period ? `Nomination period · ${period}` : "";
    case "dateLine": {
      if (!givenDate) {
        return template.text.venue || "";
      }
      const venue = String(template.text.venue || "").replace(/[.\s]+$/, "");
      return `Given this ${givenDate}${venue ? ` at ${venue}` : ""}.`;
    }
    case "signature":
      return certificate?.signatoryName || " ";
    case "signatureTitle":
      return template.text.signatoryTitle || certificate?.signatoryTitle || "OIC Regional Executive Director";
    default:
      return "";
  }
}

function CertificateLogo({
  id,
  side,
  template,
  editable,
  selected,
  onSelectElement,
  onElementPointerDown,
  onElementKeyDown,
}) {
  const logoBadge = ["executive", "burgundy", "ceremonial"].includes(template.preset);
  const image = side === "left" ? "/mgb.png" : "/bagongpilipinas.png";
  const alt = side === "left" ? "MGB Logo" : "Bagong Pilipinas";
  const item = template.elements[id];

  return (
    <div
      data-certificate-element={id}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Move ${CERTIFICATE_ELEMENT_DEFINITIONS[id]?.label || alt}` : undefined}
      onPointerDown={editable ? (event) => {
        event.stopPropagation();
        onSelectElement?.(id);
        onElementPointerDown?.(event, id);
      } : undefined}
      onKeyDown={editable ? (event) => onElementKeyDown?.(event, id) : undefined}
      style={{
        position: "absolute",
        zIndex: selected ? 20 : 6,
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.width,
        display: "grid",
        placeItems: "center",
        borderRadius: logoBadge ? "50%" : 0,
        background: logoBadge ? "#ffffff" : "transparent",
        padding: logoBadge ? 6 : 0,
        boxSizing: "border-box",
        outline: selected ? "2px solid #0ea5e9" : "2px solid transparent",
        outlineOffset: selected ? 3 : 0,
        cursor: editable ? "move" : "default",
        touchAction: editable ? "none" : "auto",
      }}
    >
      <img draggable="false" src={image} alt={alt} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
    </div>
  );
}

function CertificateSignatureImage({
  template,
  editable,
  selected,
  onSelectElement,
  onElementPointerDown,
  onElementKeyDown,
}) {
  const id = "signatureImage";
  const item = template.elements[id];
  const source = resolveBackendAssetUrl(template.signatureImage);

  if (!source) {
    return null;
  }

  return (
    <div
      data-certificate-element={id}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? "Move Signature image" : undefined}
      onPointerDown={editable ? (event) => {
        event.stopPropagation();
        onSelectElement?.(id);
        onElementPointerDown?.(event, id);
      } : undefined}
      onKeyDown={editable ? (event) => onElementKeyDown?.(event, id) : undefined}
      style={{
        position: "absolute",
        zIndex: selected ? 20 : 6,
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.width * 0.34,
        display: "grid",
        placeItems: "center",
        boxSizing: "border-box",
        outline: selected ? "2px solid #0ea5e9" : "2px solid transparent",
        outlineOffset: selected ? 3 : 0,
        cursor: editable ? "move" : "default",
        touchAction: editable ? "none" : "auto",
      }}
    >
      <img
        src={source}
        alt="Certificate signature"
        crossOrigin="anonymous"
        draggable="false"
        style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
      />
    </div>
  );
}

/**
 * Shared visual canvas used by the editor and by issued certificates. Editor-only selection handles
 * are never rendered in previews, PDFs, or printouts.
 */
export const CertificateCanvas = forwardRef(function CertificateCanvas({
  certificate,
  template,
  editable = false,
  selectedElementId = "",
  onSelectElement,
  onElementPointerDown,
  onElementKeyDown,
}, ref) {
  const resolvedTemplate = useMemo(() => normalizeCertificateTemplate(template), [template]);

  if (!certificate) {
    return null;
  }

  return (
    <div
      ref={ref}
      data-certificate-canvas="true"
      onPointerDown={(event) => {
        if (editable && !event.target.closest?.("[data-certificate-element]")) {
          onSelectElement?.("");
        }
      }}
      style={{
        position: "relative",
        width: CERTIFICATE_WIDTH,
        height: CERTIFICATE_HEIGHT,
        flex: "0 0 auto",
        overflow: "hidden",
        boxSizing: "border-box",
        color: "#111827",
        background: resolvedTemplate.paper.backgroundColor,
        boxShadow: editable ? "0 20px 50px rgba(15, 23, 42, 0.18)" : "none",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        userSelect: editable ? "none" : "text",
      }}
    >
      {resolvedTemplate.backgroundImage ? (
        <img
          src={resolveBackendAssetUrl(resolvedTemplate.backgroundImage)}
          alt=""
          crossOrigin="anonymous"
          draggable="false"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: resolvedTemplate.backgroundImageFit,
            objectPosition: "center",
            pointerEvents: "none",
          }}
        />
      ) : (
        <CertificateBackdrop template={resolvedTemplate} />
      )}
      {resolvedTemplate.showLeftLogo ? (
        <CertificateLogo
          id="leftLogo"
          side="left"
          template={resolvedTemplate}
          editable={editable}
          selected={editable && selectedElementId === "leftLogo"}
          onSelectElement={onSelectElement}
          onElementPointerDown={onElementPointerDown}
          onElementKeyDown={onElementKeyDown}
        />
      ) : null}
      {resolvedTemplate.showRightLogo ? (
        <CertificateLogo
          id="rightLogo"
          side="right"
          template={resolvedTemplate}
          editable={editable}
          selected={editable && selectedElementId === "rightLogo"}
          onSelectElement={onSelectElement}
          onElementPointerDown={onElementPointerDown}
          onElementKeyDown={onElementKeyDown}
        />
      ) : null}
      {resolvedTemplate.signatureImage ? (
        <CertificateSignatureImage
          template={resolvedTemplate}
          editable={editable}
          selected={editable && selectedElementId === "signatureImage"}
          onSelectElement={onSelectElement}
          onElementPointerDown={onElementPointerDown}
          onElementKeyDown={onElementKeyDown}
        />
      ) : null}

      {Object.entries(resolvedTemplate.elements).filter(([id]) => CERTIFICATE_ELEMENT_DEFINITIONS[id]?.type !== "image").map(([id, item]) => {
        const selected = editable && selectedElementId === id;
        const content = certificateContentFor(id, certificate, resolvedTemplate);
        const isFooter = id === "footer";
        const isSignature = id === "signature";

        if (!content && !editable && !isFooter) {
          return null;
        }

        return (
          <div
            key={id}
            data-certificate-element={id}
            role={editable ? "button" : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={editable ? `Edit ${CERTIFICATE_ELEMENT_DEFINITIONS[id]?.label || id}` : undefined}
            onPointerDown={editable ? (event) => {
              event.stopPropagation();
              onSelectElement?.(id);
              onElementPointerDown?.(event, id);
            } : undefined}
            onKeyDown={editable ? (event) => onElementKeyDown?.(event, id) : undefined}
            style={{
              position: "absolute",
              zIndex: selected ? 20 : 5,
              left: item.x,
              top: item.y,
              width: item.width,
              minHeight: Math.max(18, Number(item.fontSize || 14) * Number(item.lineHeight || 1.35)),
              boxSizing: "border-box",
              padding: editable ? "2px 4px" : isSignature ? "2px 4px 7px" : "2px 4px",
              borderBottom: isSignature ? `1px solid ${item.color || "#111827"}` : "none",
              outline: selected ? "2px solid #0ea5e9" : "2px solid transparent",
              outlineOffset: selected ? 2 : 0,
              borderRadius: editable ? 2 : 0,
              background: selected ? "rgba(224, 242, 254, 0.3)" : "transparent",
              cursor: editable ? "move" : "default",
              touchAction: editable ? "none" : "auto",
              fontFamily: item.fontFamily,
              fontSize: item.fontSize,
              fontWeight: item.fontWeight,
              fontStyle: item.fontStyle,
              textAlign: item.textAlign,
              color: item.color,
              letterSpacing: item.letterSpacing,
              textTransform: item.textTransform,
              lineHeight: item.lineHeight,
              whiteSpace: id === "organization" ? "pre-line" : "normal",
            }}
          >
            {isFooter ? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Certificate No. {certificate.certificateNumber || "—"}</span>
                <span>Awarded {formatDate(certificate.awardedOn) || "—"}</span>
              </div>
            ) : content}
          </div>
        );
      })}
    </div>
  );
});

export const AwardCertificatePaper = forwardRef(function AwardCertificatePaper({ certificate, template }, ref) {
  return <CertificateCanvas ref={ref} certificate={certificate} template={template} />;
});

/**
 * The scale at which the 960px certificate fits the element the returned ref is attached to, kept
 * current as that element resizes (a phone turned sideways, a sidebar collapsing). A callback ref
 * rather than an effect, so an element that mounts late -- after a loading state -- is still
 * measured.
 */
export function useCertificateFitScale({ min = 0.2, max = 1 } = {}) {
  const [scale, setScale] = useState(max);
  const observerRef = useRef(null);

  const ref = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect?.width || 0;
      if (width > 0) {
        setScale(Math.max(min, Math.min(max, Math.floor((width / CERTIFICATE_WIDTH) * 100) / 100)));
      }
    });
    observer.observe(node);
    observerRef.current = observer;
  }, [min, max]);

  return [ref, scale];
}

/**
 * The certificate shrunk to the width it is given, so a phone sees the whole page instead of a
 * corner of it. Only the view is scaled; print and download work from an unscaled paper.
 */
function FittedCertificate({ certificate, template }) {
  const [frameRef, scale] = useCertificateFitScale();

  return (
    <div ref={frameRef} className="w-full">
      <div
        className="mx-auto shadow-lg"
        style={{ width: CERTIFICATE_WIDTH * scale, height: CERTIFICATE_HEIGHT * scale }}
      >
        <div
          data-testid="fitted-certificate"
          style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <CertificateCanvas certificate={certificate} template={template} />
        </div>
      </div>
    </div>
  );
}

/**
 * Preview overlay shared by My Rewards, the winners tally, and certificate downloads.
 *
 * A certificate marked `isPreview` has not been issued yet — the tally shows what first place will
 * receive — so it carries no number and offers no print or download: only an issued certificate
 * should ever leave the screen as a document.
 */
export default function AwardCertificateModal({
  open = false,
  certificate = null,
  template = null,
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
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
          <div className="min-w-0 flex-1 basis-48">
            <h2 className="m-0 truncate text-lg font-semibold text-slate-950">{certificate.awardTitle}</h2>
            {certificate.isPreview ? (
              <p className="m-0 mt-1 text-sm text-amber-700">
                Preview — not yet issued. The official certificate is issued to the winner when the cycle closes.
              </p>
            ) : (
              <p className="m-0 mt-1 text-sm text-slate-500">
                Certificate No. {certificate.certificateNumber || "—"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {certificate.isPreview ? null : (
              <>
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
              </>
            )}
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

        <div className="max-h-[calc(92vh-74px)] overflow-auto bg-slate-100 p-3 sm:p-4">
          <FittedCertificate certificate={certificate} template={template} />
        </div>
      </div>

      {/*
        Print and Download work from this full-size copy. html2canvas measures the node it is given,
        and one sitting inside the scaled preview would be captured at the preview's reduced size.
        Off-screen rather than hidden, because a `display: none` paper has no layout to paint.
      */}
      <div
        aria-hidden="true"
        style={{ position: "fixed", top: 0, left: "-10000px", width: CERTIFICATE_WIDTH, pointerEvents: "none" }}
      >
        <AwardCertificatePaper ref={paperRef} certificate={certificate} template={template} />
      </div>
    </div>
  );
}
