import { CERTIFICATE_PRESETS, certificateTemplateSnapshot, createCertificateTemplate, normalizeCertificateTemplate } from "./certificateTemplate";
import { editableCertificateTemplate } from "./editableCertificateTemplate";

test.each(CERTIFICATE_PRESETS)("$name becomes editable text, images and decoration layers", ({ id }) => {
  const legacy = createCertificateTemplate(id);
  const original = JSON.stringify(legacy);
  const design = editableCertificateTemplate(legacy);
  expect(design.version).toBe(2);
  expect(design.elements.length).toBeLessThan(100);
  expect(design.elements.some((item) => item.type === "shape")).toBe(true);
  expect(design.elements.filter((item) => item.type === "image").map((item) => item.src)).toEqual(["/mgb.png", "/bagongpilipinas.png"]);
  expect(design.elements.every((item) => !item.locked)).toBe(true);
  expect(new Set(design.elements.map((item) => item.id)).size).toBe(design.elements.length);
  expect(design.elements.find((item) => item.id === "recipient").text).toBe("{{employeeName}}");
  expect(JSON.parse(certificateTemplateSnapshot(design))).toEqual(design);
  expect(editableCertificateTemplate(design)).toEqual(design);
  expect(JSON.stringify(legacy)).toBe(original);
});

test("preserves custom wording, uploaded artwork and hidden logos when upgrading a saved design", () => {
  const legacy = createCertificateTemplate("classic", { title: "Custom title", organization: "Custom bureau", venue: "Our office", signatoryTitle: "Director" });
  legacy.backgroundImage = "uploads/certificate-designs/custom.png";
  legacy.signatureImage = "uploads/certificate-signatures/signature.png";
  legacy.showLeftLogo = false;
  legacy.elements.title.x = 120;
  const design = editableCertificateTemplate(legacy);
  expect(design.backgroundImage).toBe(legacy.backgroundImage);
  expect(design.elements.find(({ id }) => id === "title")).toMatchObject({ text: "Custom title", x: 124 });
  expect(design.elements.find(({ id }) => id === "organization").text).toBe("Custom bureau");
  expect(design.elements.find(({ id }) => id === "signatureTitle").text).toBe("Director");
  expect(design.elements.find(({ id }) => id === "signatureImage").src).toBe(legacy.signatureImage);
  expect(design.elements.some(({ id }) => id === "leftLogo" || id.startsWith("decoration-"))).toBe(false);
});

test("keeps oversized decorative rings editable while rejecting unknown built-in asset paths", () => {
  const design = editableCertificateTemplate(createCertificateTemplate("sunrise"));
  expect(design.elements.find(({ id }) => id === "decoration-3")).toMatchObject({ x: -105, y: 469, strokeWidth: 48 });
  expect(normalizeCertificateTemplate({ version: 2, elements: [{ type: "image", src: "/private.png" }] }).elements[0].src).toBe("");
});
