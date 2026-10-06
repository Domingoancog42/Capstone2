import {
  fitSheetToPrintArea,
  PRINT_AREA_HEIGHT_MM,
  PRINT_AREA_WIDTH_MM,
  PRINT_PAGE_MARGIN_MM,
} from "./printSheetFit";

/*
 * html2canvas measures each font's baseline in this document, from a bare <img> placed beside a line
 * of text in a hidden nowrap <div> it appends to <body>. Tailwind's preflight makes every <img> a
 * block, which drops that image a whole line and the measured baseline with it: every line of the
 * sheet would be painted too low, and an input's value would fall out of its own box altogether.
 * For the length of a capture, the measuring image is put back inline.
 */
const FONT_METRICS_FIX_CSS = 'body > div[style*="white-space: nowrap"] > img { display: inline !important; }';

/** html2canvas paints whatever is on screen, so a seal or signature still loading would land as a blank box. */
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

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/*
 * html2canvas paints an inline SVG by loading it as an image, and an SVG loaded that way may not
 * fetch anything outside itself, so the MGB emblem in the middle of the form QR would drop out of
 * the file. Each such image is read here and handed to the clone as a data URL. One that cannot be
 * read is left alone: the QR modules under the emblem are not excavated, so the code still scans.
 */
async function readSvgImagesAsDataUrls(node) {
  const hrefs = new Set(
    Array.from(node.querySelectorAll("svg image"))
      .map((image) => image.getAttribute("href"))
      .filter((href) => href && !href.startsWith("data:")),
  );

  const entries = await Promise.all(Array.from(hrefs, async (href) => {
    try {
      const response = await fetch(href);
      return response.ok ? [href, await readBlobAsDataUrl(await response.blob())] : null;
    } catch {
      return null;
    }
  }));

  return new Map(entries.filter(Boolean));
}

const FIELD_STYLE_PROPERTIES = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-right-width",
  "border-right-style",
  "border-right-color",
  "border-bottom-width",
  "border-bottom-style",
  "border-bottom-color",
  "border-left-width",
  "border-left-style",
  "border-left-color",
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-transform",
  "text-align",
];

/*
 * A date field shows its date in the order of the computer's regional settings, which a page cannot
 * read, so "01/10/2026" on one screen is "10/01/2026" on another. The file spells the month out
 * instead, the way the sheet already writes its inclusive dates ("Oct 12, 2026").
 */
function formatDateFieldValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/*
 * html2canvas 1.4.1 sets an input's value against the font metrics of the page's body text rather
 * than the field's own (its input branch reads the wrong entries of the font it builds), so a value
 * in a 9.5px field lands a body-size line low and its own box clips it away; text-transform is
 * skipped there too. Checkboxes it draws grey and rounded, unlike the printed ones. So in the clone
 * each field stays where it is but hidden, and a plain box with its look is laid over it at exactly
 * its place and size, which leaves everything around it as it was laid out: a text field's box shows
 * the value as text, which html2canvas paints like any other line, and a checkbox's box is drawn as
 * the browser prints it.
 */
function flattenFormFields(clonedDocument, clonedSheet) {
  const view = clonedDocument.defaultView;
  const sheetRect = clonedSheet.getBoundingClientRect();
  const boxes = [];

  clonedSheet.querySelectorAll('input:not([type="radio"]), textarea').forEach((field) => {
    const computed = view.getComputedStyle(field);
    const rect = field.getBoundingClientRect();
    const box = clonedDocument.createElement("div");

    FIELD_STYLE_PROPERTIES.forEach((property) => {
      box.style.setProperty(property, computed.getPropertyValue(property));
    });
    box.style.position = "absolute";
    box.style.left = `${rect.left - sheetRect.left - clonedSheet.clientLeft}px`;
    box.style.top = `${rect.top - sheetRect.top - clonedSheet.clientTop}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.boxSizing = "border-box";
    box.style.overflow = "hidden";

    if (field.type === "checkbox") {
      const accent = computed.accentColor && computed.accentColor !== "auto" ? computed.accentColor : "#111827";
      const inner = rect.height - 2;
      box.style.border = `1px solid ${field.checked ? accent : "#767676"}`;
      box.style.borderRadius = "2px";
      box.style.background = field.checked ? accent : "#ffffff";
      box.style.color = "#ffffff";
      box.style.font = `bold ${inner}px Arial, sans-serif`;
      box.style.lineHeight = `${inner}px`;
      box.style.textAlign = "center";
      box.textContent = field.checked ? "✓" : "";
    } else {
      const isTextarea = field.tagName === "TEXTAREA";
      // A field centres its one line in its content box; a line height of that box does the same.
      const contentHeight = field.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom);
      box.style.lineHeight = isTextarea ? computed.lineHeight : `${contentHeight}px`;
      box.style.whiteSpace = isTextarea ? "pre-wrap" : "pre";
      box.textContent = field.type === "date" ? formatDateFieldValue(field.value) : field.value;
    }

    boxes.push(box);
    field.style.visibility = "hidden";
  });

  // The sheets position nothing themselves, so the sheet can anchor the boxes without moving anything.
  clonedSheet.style.position = "relative";
  boxes.forEach((box) => clonedSheet.appendChild(box));
}

/*
 * Paints the sheet laid out the way the form's print window lays it out, not the way the roomier
 * preview does. html2canvas works on a clone of the page, so the clone gets the form's print styles
 * and the same one-page fit before it is painted; the page on screen is left as it was.
 */
function paintSheet(html2canvas, sheet, { printCss, svgImageDataUrls }) {
  return html2canvas(sheet, {
    // The print styles take the type down to 8px; 3x keeps it legible on paper, as on the DTR.
    scale: 3,
    useCORS: true,
    backgroundColor: "#ffffff",
    // A desktop-sized window for the clone, so no phone-only rule reaches the sheet.
    windowWidth: 1280,
    onclone: (clonedDocument, clonedSheet) => {
      // Each form's preview card eases in from a smaller, see-through state; the clone must not catch it mid-way.
      for (let node = clonedSheet.parentElement; node; node = node.parentElement) {
        node.style.transform = "none";
        node.style.opacity = "1";
      }

      clonedSheet.querySelectorAll("svg image").forEach((image) => {
        const dataUrl = svgImageDataUrls.get(image.getAttribute("href"));
        if (dataUrl) {
          image.setAttribute("href", dataUrl);
        }
      });

      /*
       * The print window holds nothing but the sheet and its print styles. The app's own styles would
       * reflow the copy -- Tailwind's 1.5 line height alone makes a sheet a tenth taller than its
       * printout -- so the copy drops them too. The sheets style themselves inline, which is why they
       * print correctly; html2canvas's own rules (its `___html2canvas___` classes) stay.
       */
      clonedDocument.querySelectorAll('link[rel="stylesheet"], style').forEach((stylesheet) => {
        if (!stylesheet.textContent.includes("___html2canvas___")) {
          stylesheet.remove();
        }
      });

      if (printCss) {
        const style = clonedDocument.createElement("style");
        style.textContent = printCss;
        clonedDocument.head.appendChild(style);
      }

      // The print windows' shell, so the print styles and the fit find the sheet as they do there.
      clonedSheet.parentElement?.classList.add("print-shell");
      clonedSheet.style.maxWidth = "none";
      clonedSheet.style.boxShadow = "none";
      clonedSheet.style.color = "#000000";
      fitSheetToPrintArea(clonedDocument);
      /*
       * The fit lays a long sheet out wider and shrinks it back with a transform. The PDF page does
       * that shrinking below, and html2canvas would paint a transformed sheet into a corner of its canvas.
       */
      clonedSheet.style.transform = "none";
      // Last, once the sheet is laid out as it prints, so each field is frozen at its printed size.
      flattenFormFields(clonedDocument, clonedSheet);
    },
  });
}

/*
 * Download PDF for the request forms whose preview prints itself: the leave application (with the
 * leave monetization), the travel order and the CTO form. `sheet` is the paper the preview renders,
 * and `printCss` the styles its print window uses.
 *
 * Like the DTR and certificate exports, the file is painted from that sheet rather than redrawn in
 * jsPDF, but laid out as the printout is: the same type sizes and spacing on one A4 page, placed
 * where the print window puts it. It comes out the same from a phone as from a desktop.
 */
export async function downloadFormSheetPdf(sheet, { fileName, printCss = "" }) {
  if (!sheet) {
    throw new Error("The form is not ready yet.");
  }

  const [{ default: html2canvas }, { jsPDF }, svgImageDataUrls] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    readSvgImagesAsDataUrls(sheet),
  ]);

  await waitForImages(sheet);

  const metricsFix = document.createElement("style");
  metricsFix.textContent = FONT_METRICS_FIX_CSS;
  document.head.appendChild(metricsFix);

  let canvas;
  try {
    canvas = await paintSheet(html2canvas, sheet, { printCss, svgImageDataUrls });
  } finally {
    metricsFix.remove();
  }

  const pdf = new jsPDF("p", "mm", "a4");
  const scale = Math.min(PRINT_AREA_WIDTH_MM / canvas.width, PRINT_AREA_HEIGHT_MM / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;

  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    (pdf.internal.pageSize.getWidth() - width) / 2,
    PRINT_PAGE_MARGIN_MM,
    width,
    height,
    undefined,
    // Left uncompressed, jsPDF stores the 3x sheet as raw pixels: over 20 MB for this one page.
    "FAST",
  );
  pdf.save(fileName);
}
