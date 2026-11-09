import { createBlankCertificateTemplate, createCanvasElement, normalizeCertificateTemplate } from "./certificateTemplate";

// Preset decorations become ordinary layers, so no part of the design is baked into an image.
function decorationLayers({ preset, paper }) {
  const { primaryColor: primary, accentColor: accent, backgroundColor: background } = paper;
  const layers = [];
  const rect = (x, y, width, height, fill, extra = {}) => layers.push(createCanvasElement("shape", {
    id: `decoration-${layers.length + 1}`, x, y, width, height, fill, ...extra,
  }));
  const frame = (inset, stroke, strokeWidth) => rect(inset, inset, 960 - inset * 2, 679 - inset * 2, "transparent", { stroke, strokeWidth });
  const ring = (x, y, size, stroke, strokeWidth, opacity) => rect(x, y, size, size, "transparent", { shape: "ellipse", stroke, strokeWidth, opacity });
  const rule = (x, y, width, fill, opacity = 1, height = 1) => rect(x, y, width, height, fill, { opacity });
  switch (preset) {
    case "emerald":
      frame(9, primary, 6); frame(20, accent, 1);
      rect(31, 31, 25, 25, "transparent", { stroke: accent, strokeWidth: 2, rotation: 45 });
      rect(904, 623, 25, 25, "transparent", { stroke: accent, strokeWidth: 2, rotation: 45 });
      rule(105, 152, 750, accent, 1, 2); rule(150, 322, 660, primary, 0.333);
      break;
    case "burgundy":
    case "executive":
    case "ceremonial": {
      const ceremonial = preset === "ceremonial";
      rect(0, 0, 960, ceremonial ? 130 : 132, primary);
      rect(0, ceremonial ? 130 : 132, 960, ceremonial ? 9 : 7, accent);
      if (ceremonial) {
        frame(10, primary, 3); frame(18, accent, 1);
        ring(340, 159, 280, primary, 34, 8 / 255);
        rule(105, 319, 750, accent, 144 / 255); rule(96, 630, 768, accent, 1, 3);
      } else {
        frame(12, accent, 1);
        if (preset === "burgundy") {
          rect(-48, 104, 180, 18, accent, { rotation: -35, opacity: 0.75 });
          rect(828, 104, 180, 18, accent, { rotation: 35, opacity: 0.75 });
          rule(105, 320, 750, primary, 64 / 255); rule(98, 630, 764, primary, 1, 3);
        } else {
          rule(94, 318, 772, accent, 133 / 255); rule(98, 631, 764, primary, 37 / 255);
        }
      }
      break;
    }
    case "minimal":
      rect(24, 24, 912, 631, "transparent", { stroke: primary, strokeWidth: 1, opacity: 64 / 255 });
      rule(75, 151, 810, accent);
      rect(473.5, 145, 13, 13, background, { stroke: accent, strokeWidth: 1, rotation: 45 });
      rule(108, 331, 744, primary, 24 / 255); rule(75, 633, 810, primary, 48 / 255);
      break;
    case "geometric":
      rect(0, 0, 26, 679, primary); rect(26, 0, 934, 10, accent);
      rect(780, -135, 300, 300, primary, { opacity: 18 / 255, rotation: 45 });
      rect(830, 151, 94, 12, accent); rect(116, 326, 105, 5, primary);
      rule(116, 634, 764, accent, 1, 2);
      rect(855, 589, 150, 16, primary, { opacity: 32 / 255, rotation: -45 });
      break;
    case "academic":
      rect(0, 0, 16, 679, primary); rect(944, 0, 16, 679, primary);
      frame(25, primary, 2); frame(33, accent, 1);
      rect(150, 145, 660, 18, accent, { shape: "ellipse", opacity: 37 / 255 });
      rule(115, 323, 730, primary, 85 / 255); rule(145, 632, 670, primary, 1, 2);
      break;
    case "sunrise":
      rect(0, 0, 960, 11, accent); frame(20, primary, 2);
      ring(-105, 469, 330, accent, 48, 32 / 255); ring(755, -155, 350, primary, 55, 16 / 255);
      rule(115, 151, 730, accent, 1, 4); rule(130, 326, 700, primary, 80 / 255);
      break;
    case "modern":
      rect(0, 0, 25, 679, primary); rect(25, 0, 935, 8, accent);
      ring(790, -70, 235, primary, 42, 18 / 255);
      rect(116, 325, 80, 4, accent, { borderRadius: 4 }); rule(116, 635, 762, primary, 37 / 255);
      break;
    default:
      frame(10, primary, 3); frame(18, accent, 1);
      rule(42, 145, 876, accent, 1, 5); rule(100, 322, 760, primary, 85 / 255);
      rect(46, 46, 56, 3, accent); rect(46, 49, 3, 53, accent);
      rect(858, 630, 56, 3, accent); rect(911, 577, 3, 53, accent);
  }
  return layers;
}

/** Upgrade only the editor's copy. Issued certificate snapshots keep their original rendering. */
export function editableCertificateTemplate(value) {
  const template = normalizeCertificateTemplate(value);
  if (template.version === 2) return template;
  const elements = template.backgroundImage ? [] : decorationLayers(template);
  const text = {
    ...template.text,
    recipient: "{{employeeName}}",
    job: "{{designationTitle}} · {{divisionName}}",
    award: "{{awardTitle}}",
    period: "Nomination period · {{awardPeriod}}",
    dateLine: `Given on {{awardedOn}}${template.text.venue ? ` at ${template.text.venue.replace(/[.\s]+$/, "")}` : ""}.`,
    signature: "{{signatoryName}}",
    signatureTitle: template.text.signatoryTitle || "{{signatoryTitle}}",
  };
  const heights = { organization: 100, title: 48, lead: 28, recipient: 50, job: 32, message: 32,
    award: 40, period: 28, closing: 38, dateLine: 44, signature: 28, signatureTitle: 30 };
  for (const [id, item] of Object.entries(template.elements)) {
    if (["leftLogo", "rightLogo", "signatureImage"].includes(id)) continue;
    if (id === "footer") {
      elements.push(createCanvasElement("text", { ...item, id: "footer-number", text: "Certificate No. {{certificateNumber}}",
        x: item.x + 4, y: item.y + 2, width: item.width / 2 - 4, height: 25, textAlign: "left" }));
      elements.push(createCanvasElement("text", { ...item, id: "footer-date", text: "Awarded {{awardedOn}}",
        x: item.x + item.width / 2, y: item.y + 2, width: item.width / 2 - 4, height: 25, textAlign: "right" }));
      continue;
    }
    elements.push(createCanvasElement("text", { ...item, id, text: text[id] || "",
      x: item.x + 4, y: item.y + 2, width: item.width - 8, height: heights[id] || 40 }));
    if (id === "signature") elements.push(createCanvasElement("shape", { id: "signature-rule", shape: "line",
      x: item.x, y: item.y + item.fontSize * item.lineHeight + 9, width: item.width, height: 1,
      fill: "transparent", stroke: item.color, strokeWidth: 1 }));
  }
  for (const [id, src, visible] of [["leftLogo", "/mgb.png", template.showLeftLogo],
    ["rightLogo", "/bagongpilipinas.png", template.showRightLogo], ["signatureImage", template.signatureImage, Boolean(template.signatureImage)]]) {
    if (!visible) continue;
    const item = template.elements[id];
    const badge = id !== "signatureImage" && ["executive", "burgundy", "ceremonial"].includes(template.preset);
    if (badge) elements.push(createCanvasElement("shape", { id: `${id}-badge`, shape: "ellipse", x: item.x, y: item.y,
      width: item.width, height: item.width, fill: "#ffffff" }));
    elements.push(createCanvasElement("image", { id, src, x: item.x + (badge ? 6 : 0), y: item.y + (badge ? 6 : 0),
      width: item.width - (badge ? 12 : 0), height: id === "signatureImage" ? item.width * 0.34 : item.width - (badge ? 12 : 0) }));
  }
  return normalizeCertificateTemplate({ ...createBlankCertificateTemplate(), paper: { backgroundColor: template.paper.backgroundColor },
    backgroundImage: template.backgroundImage, backgroundImageFit: template.backgroundImageFit, elements });
}
