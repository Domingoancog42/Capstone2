export const CERTIFICATE_WIDTH = 960;
export const CERTIFICATE_HEIGHT = 679;

export const CERTIFICATE_FONT_OPTIONS = [
  { label: "Classic serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Formal serif", value: "'Times New Roman', Times, serif" },
  { label: "Elegant Garamond", value: "Garamond, 'Times New Roman', serif" },
  { label: "Palatino", value: "'Palatino Linotype', Palatino, serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Book Antiqua", value: "'Book Antiqua', Palatino, serif" },
  { label: "Baskerville", value: "Baskerville, Georgia, serif" },
  { label: "Clean sans", value: "Arial, Helvetica, sans-serif" },
  { label: "Modern sans", value: "'Trebuchet MS', Arial, sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', Arial, sans-serif" },
  { label: "Century Gothic", value: "'Century Gothic', Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Franklin Gothic", value: "'Franklin Gothic Medium', Arial, sans-serif" },
  { label: "Monotype Corsiva", value: "'Monotype Corsiva', 'Segoe Script', cursive" },
  { label: "Brush Script", value: "'Brush Script MT', 'Segoe Script', cursive" },
  { label: "Segoe Script", value: "'Segoe Script', 'Brush Script MT', cursive" },
];

export const CERTIFICATE_ELEMENT_DEFINITIONS = {
  leftLogo: { label: "MGB logo", type: "image" },
  rightLogo: { label: "Bagong Pilipinas logo", type: "image" },
  organization: { label: "Organization header", textKey: "organization", multiline: true },
  title: { label: "Certificate title", textKey: "title" },
  lead: { label: "Recipient introduction", textKey: "lead" },
  recipient: { label: "Recipient name", dynamic: true },
  job: { label: "Position and division", dynamic: true },
  message: { label: "Recognition message", textKey: "message", multiline: true },
  award: { label: "Award name", dynamic: true },
  period: { label: "Award period", dynamic: true },
  closing: { label: "Closing message", textKey: "closing", multiline: true },
  dateLine: { label: "Award venue", textKey: "venue", multiline: true },
  signatureImage: { label: "Signature image", type: "image" },
  signature: { label: "Signatory name", dynamic: true },
  signatureTitle: { label: "Signatory title", textKey: "signatoryTitle" },
  footer: { label: "Certificate details", dynamic: true },
};

const serif = CERTIFICATE_FONT_OPTIONS[0].value;
const formalSerif = CERTIFICATE_FONT_OPTIONS[1].value;
const sans = CERTIFICATE_FONT_OPTIONS[2].value;
const modernSans = CERTIFICATE_FONT_OPTIONS[3].value;

const sharedText = {
  organization: "Republic of the Philippines\nDepartment of Environment and Natural Resources\nMINES AND GEOSCIENCES BUREAU\nRegional Office No. X\nDENR-X Compound, Puntod, Cagayan de Oro City",
  title: "CERTIFICATE OF RECOGNITION",
  lead: "is proudly presented to",
  message: "for having been chosen by peers as",
  closing: "In recognition of outstanding service, dedication, and contribution to the Bureau.",
  venue: "the Mines and Geosciences Bureau, Regional Office No. X, Cagayan de Oro City",
  signatoryTitle: "OIC Regional Executive Director",
};

const element = (x, y, width, overrides = {}) => ({
  x,
  y,
  width,
  fontSize: 14,
  fontFamily: sans,
  fontWeight: 400,
  fontStyle: "normal",
  textAlign: "center",
  color: "#334155",
  letterSpacing: 0,
  textTransform: "none",
  lineHeight: 1.35,
  ...overrides,
});

function centeredPresetElements({
  primary,
  fontFamily = serif,
  organizationColor = "#334155",
  logoY = 35,
  titleY = 176,
  titleSpacing = 3,
  muted = "#64748b",
}) {
  return {
    leftLogo: element(55, logoY, 70),
    rightLogo: element(835, logoY, 70),
    organization: element(195, logoY - 4, 570, { fontSize: 11, fontWeight: 500, color: organizationColor, lineHeight: 1.3 }),
    title: element(90, titleY, 780, { fontSize: 29, fontFamily, fontWeight: 700, color: primary, letterSpacing: titleSpacing }),
    lead: element(245, titleY + 51, 470, { fontSize: 14, fontFamily, fontStyle: "italic", color: muted }),
    recipient: element(105, titleY + 79, 750, { fontSize: 36, fontFamily, fontWeight: 700, color: primary, letterSpacing: 0.4 }),
    job: element(180, titleY + 130, 600, { fontSize: 11, color: muted }),
    message: element(175, titleY + 165, 610, { fontSize: 13, fontFamily, color: "#334155" }),
    award: element(130, titleY + 198, 700, { fontSize: 21, fontFamily, fontWeight: 700, color: primary, letterSpacing: 1.2, textTransform: "uppercase" }),
    period: element(180, titleY + 241, 600, { fontSize: 11, color: muted }),
    closing: element(170, titleY + 272, 620, { fontSize: 11, fontFamily, color: "#475569" }),
    dateLine: element(165, titleY + 306, 630, { fontSize: 10, color: muted, lineHeight: 1.45 }),
    signatureImage: element(650, 492, 160),
    signature: element(590, 543, 280, { fontSize: 14, fontFamily, fontWeight: 700, color: primary, textTransform: "uppercase" }),
    signatureTitle: element(600, 577, 260, { fontSize: 10, color: muted }),
    footer: element(52, 632, 856, { fontSize: 9, color: muted }),
  };
}

function leftPresetElements({ primary, accent = primary, organizationColor = "#475569", logoY = 35 }) {
  return {
    leftLogo: element(42, logoY, 70),
    rightLogo: element(835, logoY, 70),
    organization: element(126, logoY + 3, 675, { fontSize: 11, fontFamily: modernSans, fontWeight: 500, textAlign: "left", color: organizationColor, lineHeight: 1.3 }),
    title: element(116, 182, 690, { fontSize: 30, fontFamily: modernSans, fontWeight: 700, textAlign: "left", color: primary, letterSpacing: 2 }),
    lead: element(118, 232, 600, { fontSize: 13, fontFamily: modernSans, textAlign: "left", color: "#64748b" }),
    recipient: element(116, 259, 700, { fontSize: 38, fontFamily: modernSans, fontWeight: 700, textAlign: "left", color: "#0f172a" }),
    job: element(118, 310, 650, { fontSize: 11, textAlign: "left", color: "#64748b" }),
    message: element(118, 352, 610, { fontSize: 13, fontFamily: modernSans, textAlign: "left", color: "#475569" }),
    award: element(116, 383, 690, { fontSize: 22, fontFamily: modernSans, fontWeight: 700, textAlign: "left", color: accent }),
    period: element(118, 424, 630, { fontSize: 11, textAlign: "left", color: "#64748b" }),
    closing: element(118, 459, 570, { fontSize: 11, textAlign: "left", color: "#475569", lineHeight: 1.5 }),
    dateLine: element(118, 501, 560, { fontSize: 10, textAlign: "left", color: "#64748b", lineHeight: 1.45 }),
    signatureImage: element(680, 480, 150),
    signature: element(642, 530, 235, { fontSize: 14, fontFamily: modernSans, fontWeight: 700, color: primary, textTransform: "uppercase" }),
    signatureTitle: element(642, 565, 235, { fontSize: 10, color: "#64748b" }),
    footer: element(118, 632, 760, { fontSize: 9, textAlign: "left", color: "#64748b" }),
  };
}

const presetDefinitions = {
  classic: {
    id: "classic",
    name: "Classic Gold",
    description: "Formal double border with a warm ceremonial finish.",
    paper: {
      backgroundColor: "#fffdf7",
      primaryColor: "#8a641f",
      accentColor: "#d6ae4b",
    },
    elements: {
      leftLogo: element(55, 35, 70),
      rightLogo: element(835, 35, 70),
      organization: element(205, 31, 550, { fontSize: 11, fontWeight: 500, color: "#334155", lineHeight: 1.3 }),
      title: element(100, 176, 760, { fontSize: 29, fontFamily: serif, fontWeight: 700, color: "#765315", letterSpacing: 5 }),
      lead: element(245, 226, 470, { fontSize: 14, fontFamily: serif, fontStyle: "italic", color: "#64748b" }),
      recipient: element(105, 254, 750, { fontSize: 36, fontFamily: serif, fontWeight: 700, color: "#111827", letterSpacing: 0.5 }),
      job: element(180, 304, 600, { fontSize: 11, color: "#64748b" }),
      message: element(175, 337, 610, { fontSize: 13, fontFamily: serif, color: "#334155" }),
      award: element(130, 370, 700, { fontSize: 21, fontFamily: serif, fontWeight: 700, color: "#765315", letterSpacing: 1.5, textTransform: "uppercase" }),
      period: element(180, 413, 600, { fontSize: 11, color: "#64748b" }),
      closing: element(170, 443, 620, { fontSize: 11, fontFamily: serif, color: "#475569" }),
      dateLine: element(165, 477, 630, { fontSize: 10, color: "#64748b", lineHeight: 1.45 }),
      signatureImage: element(650, 492, 160),
      signature: element(590, 542, 280, { fontSize: 14, fontFamily: serif, fontWeight: 700, color: "#111827", textTransform: "uppercase" }),
      signatureTitle: element(600, 575, 260, { fontSize: 10, color: "#64748b" }),
      footer: element(50, 631, 860, { fontSize: 9, color: "#64748b" }),
    },
  },
  modern: {
    id: "modern",
    name: "Modern Teal",
    description: "A bright, clean layout with a strong contemporary edge.",
    paper: {
      backgroundColor: "#ffffff",
      primaryColor: "#0f766e",
      accentColor: "#f4b942",
    },
    elements: {
      leftLogo: element(42, 35, 70),
      rightLogo: element(835, 35, 70),
      organization: element(126, 38, 675, { fontSize: 11, fontFamily: modernSans, fontWeight: 500, textAlign: "left", color: "#475569", lineHeight: 1.3 }),
      title: element(116, 182, 690, { fontSize: 30, fontFamily: modernSans, fontWeight: 700, textAlign: "left", color: "#0f766e", letterSpacing: 2 }),
      lead: element(118, 232, 600, { fontSize: 13, fontFamily: modernSans, textAlign: "left", color: "#64748b" }),
      recipient: element(116, 259, 700, { fontSize: 38, fontFamily: modernSans, fontWeight: 700, textAlign: "left", color: "#0f172a" }),
      job: element(118, 310, 650, { fontSize: 11, textAlign: "left", color: "#64748b" }),
      message: element(118, 352, 610, { fontSize: 13, fontFamily: modernSans, textAlign: "left", color: "#475569" }),
      award: element(116, 383, 690, { fontSize: 22, fontFamily: modernSans, fontWeight: 700, textAlign: "left", color: "#0f766e" }),
      period: element(118, 424, 630, { fontSize: 11, textAlign: "left", color: "#64748b" }),
      closing: element(118, 459, 570, { fontSize: 11, textAlign: "left", color: "#475569", lineHeight: 1.5 }),
      dateLine: element(118, 501, 560, { fontSize: 10, textAlign: "left", color: "#64748b", lineHeight: 1.45 }),
      signatureImage: element(680, 480, 150),
      signature: element(642, 530, 235, { fontSize: 14, fontFamily: modernSans, fontWeight: 700, color: "#0f172a", textTransform: "uppercase" }),
      signatureTitle: element(642, 565, 235, { fontSize: 10, color: "#64748b" }),
      footer: element(118, 632, 760, { fontSize: 9, textAlign: "left", color: "#64748b" }),
    },
  },
  executive: {
    id: "executive",
    name: "Executive Blue",
    description: "Deep navy and restrained gold for senior recognition.",
    paper: {
      backgroundColor: "#fbfcff",
      primaryColor: "#17325c",
      accentColor: "#c9a44c",
    },
    elements: {
      leftLogo: element(55, 30, 70),
      rightLogo: element(835, 30, 70),
      organization: element(188, 28, 584, { fontSize: 11, fontFamily: sans, fontWeight: 500, color: "#ffffff", lineHeight: 1.3 }),
      title: element(100, 168, 760, { fontSize: 29, fontFamily: formalSerif, fontWeight: 700, color: "#17325c", letterSpacing: 4 }),
      lead: element(250, 219, 460, { fontSize: 14, fontFamily: formalSerif, fontStyle: "italic", color: "#64748b" }),
      recipient: element(100, 249, 760, { fontSize: 36, fontFamily: formalSerif, fontWeight: 700, color: "#17325c" }),
      job: element(180, 300, 600, { fontSize: 11, color: "#64748b" }),
      message: element(175, 338, 610, { fontSize: 13, fontFamily: formalSerif, color: "#334155" }),
      award: element(130, 372, 700, { fontSize: 21, fontFamily: formalSerif, fontWeight: 700, color: "#17325c", letterSpacing: 1.2, textTransform: "uppercase" }),
      period: element(180, 415, 600, { fontSize: 11, color: "#64748b" }),
      closing: element(170, 447, 620, { fontSize: 11, fontFamily: formalSerif, color: "#475569" }),
      dateLine: element(165, 481, 630, { fontSize: 10, color: "#64748b", lineHeight: 1.45 }),
      signatureImage: element(650, 492, 160),
      signature: element(595, 543, 280, { fontSize: 14, fontFamily: formalSerif, fontWeight: 700, color: "#17325c", textTransform: "uppercase" }),
      signatureTitle: element(610, 577, 250, { fontSize: 10, color: "#64748b" }),
      footer: element(52, 632, 856, { fontSize: 9, color: "#64748b" }),
    },
  },
  emerald: {
    id: "emerald",
    name: "Emerald Prestige",
    description: "Rich green framing with refined gold details.",
    paper: {
      backgroundColor: "#fffef8",
      primaryColor: "#166534",
      accentColor: "#c7a64a",
    },
    elements: centeredPresetElements({ primary: "#166534", titleSpacing: 3.5 }),
  },
  burgundy: {
    id: "burgundy",
    name: "Burgundy Honor",
    description: "A dignified wine-red header for formal awards.",
    paper: {
      backgroundColor: "#fffaf7",
      primaryColor: "#7f1d1d",
      accentColor: "#d4a64a",
    },
    elements: centeredPresetElements({ primary: "#7f1d1d", organizationColor: "#ffffff", logoY: 30, titleY: 169, titleSpacing: 3.5 }),
  },
  minimal: {
    id: "minimal",
    name: "Minimal Ivory",
    description: "Quiet typography and generous space for a timeless look.",
    paper: {
      backgroundColor: "#fffffc",
      primaryColor: "#1f2937",
      accentColor: "#b9a37b",
    },
    elements: centeredPresetElements({ primary: "#1f2937", fontFamily: modernSans, titleY: 184, titleSpacing: 1.5, muted: "#6b7280" }),
  },
  geometric: {
    id: "geometric",
    name: "Geometric Slate",
    description: "Bold architectural shapes with a crisp modern layout.",
    paper: {
      backgroundColor: "#f8fafc",
      primaryColor: "#334155",
      accentColor: "#f59e0b",
    },
    elements: leftPresetElements({ primary: "#334155", accent: "#b45309" }),
  },
  ceremonial: {
    id: "ceremonial",
    name: "Ceremonial Crimson",
    description: "Confident bureau red balanced by a formal gold trim.",
    paper: {
      backgroundColor: "#fffdfb",
      primaryColor: "#b91c1c",
      accentColor: "#e3b341",
    },
    elements: centeredPresetElements({ primary: "#991b1b", organizationColor: "#ffffff", logoY: 30, titleY: 169, titleSpacing: 4 }),
  },
  academic: {
    id: "academic",
    name: "Academic Blue",
    description: "Scholarly blue framing with a traditional serif finish.",
    paper: {
      backgroundColor: "#f8fbff",
      primaryColor: "#1e3a8a",
      accentColor: "#60a5fa",
    },
    elements: centeredPresetElements({ primary: "#1e3a8a", fontFamily: formalSerif, titleSpacing: 4 }),
  },
  sunrise: {
    id: "sunrise",
    name: "Golden Sunrise",
    description: "Warm amber curves for uplifting employee milestones.",
    paper: {
      backgroundColor: "#fffaf0",
      primaryColor: "#9a3412",
      accentColor: "#f59e0b",
    },
    elements: centeredPresetElements({ primary: "#9a3412", fontFamily: modernSans, titleY: 179, titleSpacing: 2 }),
  },
};

export const CERTIFICATE_PRESETS = Object.values(presetDefinitions);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createCertificateTemplate(presetId = "classic", text = sharedText) {
  const preset = presetDefinitions[presetId] || presetDefinitions.classic;

  return {
    version: 1,
    preset: preset.id,
    paper: clone(preset.paper),
    text: { ...sharedText, ...(text || {}) },
    backgroundImage: "",
    backgroundImageFit: "cover",
    signatureImage: "",
    showLeftLogo: true,
    showRightLogo: true,
    elements: clone(preset.elements),
  };
}

export const DEFAULT_CERTIFICATE_TEMPLATE = createCertificateTemplate();

export function applyCertificatePreset(presetId, currentTemplate) {
  const current = normalizeCertificateTemplate(currentTemplate);
  const next = createCertificateTemplate(presetId, current.text);

  return {
    ...next,
    showLeftLogo: current.showLeftLogo,
    showRightLogo: current.showRightLogo,
  };
}

/** Keep an independent in-editor draft for every design the user has touched. */
export function rememberCertificateTemplateDraft(drafts, template) {
  const normalized = normalizeCertificateTemplate(template);

  return {
    ...(drafts || {}),
    [normalized.preset]: normalized,
  };
}

/** Restore a design's draft when revisiting it, or create its first draft from the current wording. */
export function certificateTemplateDraftForPreset(drafts, presetId, currentTemplate) {
  return drafts?.[presetId]
    ? normalizeCertificateTemplate(drafts[presetId])
    : applyCertificatePreset(presetId, currentTemplate);
}

export function normalizeCertificateTemplate(value) {
  const presetId = presetDefinitions[value?.preset] ? value.preset : "classic";
  const base = createCertificateTemplate(presetId, value?.text);

  return {
    ...base,
    version: 1,
    paper: { ...base.paper, ...(value?.paper || {}) },
    text: { ...base.text, ...(value?.text || {}) },
    backgroundImage: String(value?.backgroundImage || ""),
    backgroundImageFit: value?.backgroundImageFit === "contain" ? "contain" : "cover",
    signatureImage: String(value?.signatureImage || ""),
    showLeftLogo: value?.showLeftLogo !== false,
    showRightLogo: value?.showRightLogo !== false,
    elements: Object.keys(base.elements).reduce((items, key) => {
      items[key] = { ...base.elements[key], ...(value?.elements?.[key] || {}) };
      return items;
    }, {}),
  };
}

export function certificateTemplateSnapshot(template) {
  return JSON.stringify(normalizeCertificateTemplate(template));
}
