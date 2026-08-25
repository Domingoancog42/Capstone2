import {
  applyCertificatePreset,
  CERTIFICATE_ELEMENT_DEFINITIONS,
  CERTIFICATE_FONT_OPTIONS,
  CERTIFICATE_PRESETS,
  certificateTemplateDraftForPreset,
  createCertificateTemplate,
  normalizeCertificateTemplate,
  rememberCertificateTemplateDraft,
} from "./certificateTemplate";

describe("certificate templates", () => {
  test("ships a complete editable classic design", () => {
    const template = createCertificateTemplate();

    expect(template.preset).toBe("classic");
    expect(Object.keys(template.elements)).toEqual(Object.keys(CERTIFICATE_ELEMENT_DEFINITIONS));
    expect(template.text.title).toBe("CERTIFICATE OF RECOGNITION");
  });

  test("provides ten complete visual designs", () => {
    expect(CERTIFICATE_PRESETS).toHaveLength(10);

    CERTIFICATE_PRESETS.forEach((preset) => {
      const template = createCertificateTemplate(preset.id);
      expect(template.preset).toBe(preset.id);
      expect(Object.keys(template.elements)).toEqual(Object.keys(CERTIFICATE_ELEMENT_DEFINITIONS));
      expect(template.paper.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  test("offers a broad certificate-safe font collection", () => {
    expect(CERTIFICATE_FONT_OPTIONS).toHaveLength(17);
    expect(CERTIFICATE_FONT_OPTIONS.map((font) => font.label)).toEqual(expect.arrayContaining([
      "Elegant Garamond",
      "Century Gothic",
      "Monotype Corsiva",
      "Brush Script",
    ]));
  });

  test("switching designs keeps wording and logo choices without copying the signature", () => {
    const current = createCertificateTemplate();
    current.text.title = "CERTIFICATE OF EXCELLENCE";
    current.showRightLogo = false;
    current.signatureImage = "uploads/certificate-signatures/classic.png";

    const modern = applyCertificatePreset("modern", current);

    expect(modern.preset).toBe("modern");
    expect(modern.text.title).toBe("CERTIFICATE OF EXCELLENCE");
    expect(modern.showRightLogo).toBe(false);
    expect(modern.signatureImage).toBe("");
    expect(modern.elements.title.textAlign).toBe("left");
  });

  test("normalization restores missing visual fields", () => {
    const template = normalizeCertificateTemplate({
      preset: "executive",
      text: { lead: "is awarded to" },
      elements: { title: { fontSize: 42 } },
    });

    expect(template.text.lead).toBe("is awarded to");
    expect(template.text.organization).toContain("MINES AND GEOSCIENCES BUREAU");
    expect(template.elements.title.fontSize).toBe(42);
    expect(template.elements.recipient.width).toBeGreaterThan(0);
  });

  test("switching away and back restores each design's edits", () => {
    const classic = createCertificateTemplate("classic");
    classic.text.title = "MY CUSTOM CERTIFICATE";
    classic.elements.leftLogo.x = 140;

    let drafts = rememberCertificateTemplateDraft({}, classic);
    const modern = certificateTemplateDraftForPreset(drafts, "modern", classic);
    modern.paper.primaryColor = "#115e59";
    drafts = rememberCertificateTemplateDraft(drafts, modern);

    const restoredClassic = certificateTemplateDraftForPreset(drafts, "classic", modern);

    expect(restoredClassic.text.title).toBe("MY CUSTOM CERTIFICATE");
    expect(restoredClassic.elements.leftLogo.x).toBe(140);
    expect(drafts.modern.paper.primaryColor).toBe("#115e59");
  });
});
