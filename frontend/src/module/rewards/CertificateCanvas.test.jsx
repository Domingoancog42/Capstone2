/* React DOM helpers below are not Testing Library render utilities. */
/* eslint-disable testing-library/no-unnecessary-act, testing-library/render-result-naming-convention */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AwardCertificatePaper, CertificateCanvas } from "./AwardCertificate";
import {
  CERTIFICATE_DYNAMIC_FIELDS,
  certificateTemplateSnapshot,
  createBlankCertificateTemplate,
  createCanvasElement,
  createCertificateTemplate,
  normalizeCertificateTemplate,
  resolveCertificateText,
} from "./certificateTemplate";

jest.mock("html2canvas", () => jest.fn());
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));

const certificate = {
  employeeName: "Alex Santos",
  designationTitle: "Geologist",
  divisionName: "Geosciences",
  awardTitle: "Service Excellence",
  awardedOn: "2026-10-18",
  signatoryName: "Jamie Cruz",
  signatoryTitle: "Regional Director",
  certificateNumber: "MGB-2026-001",
  opensOn: "2026-10-01",
  closesOn: "2026-10-18",
};

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderCanvas(props = {}) {
  act(() => root.render(<CertificateCanvas certificate={certificate} {...props} />));
  return container.querySelector("[data-certificate-canvas]");
}

test("a new certificate starts as empty white paper with no preset output", () => {
  const blank = createCertificateTemplate();
  expect(blank).toEqual(createBlankCertificateTemplate());
  expect(normalizeCertificateTemplate(null)).toEqual(blank);
  const paper = renderCanvas({ template: blank });
  expect(paper.style.background).toBe("rgb(255, 255, 255)");
  expect(paper.childElementCount).toBe(0);
  expect(paper.textContent).toBe("");
});

test("saved legacy designs retain their preset visuals and wording", () => {
  const oldTemplate = createCertificateTemplate("classic", { title: "A historic award" });
  const normalized = normalizeCertificateTemplate(oldTemplate);
  expect(normalized.version).toBe(1);
  expect(normalized.preset).toBe("classic");
  expect(normalized.elements.title).toEqual(oldTemplate.elements.title);
  renderCanvas({ template: normalized });
  expect(container.textContent).toContain("A historic award");
  expect(container.querySelectorAll("img")).toHaveLength(2);
  expect(container.querySelector('[data-certificate-element="footer"]')).not.toBeNull();
});

test("canvas design keeps layer order, dimensions and styling in its saved snapshot", () => {
  const design = {
    ...createBlankCertificateTemplate(),
    elements: [
      createCanvasElement("shape", { id: "background", x: 5, y: 5, width: 700, height: 600, fill: "#fde68a", opacity: 0.6 }),
      createCanvasElement("text", { id: "title", text: "A custom award", x: 100, y: 100, width: 500, height: 90, rotation: 12 }),
      createCanvasElement("image", { id: "logo", src: "uploads/certificate-designs/logo.png", width: 120, height: 80, fit: "cover" }),
    ],
  };
  const saved = JSON.parse(certificateTemplateSnapshot(design));
  expect(saved.elements.map(({ id }) => id)).toEqual(["background", "title", "logo"]);
  expect(saved.elements[0].opacity).toBe(0.6);
  const paper = renderCanvas({ template: saved });
  expect([...paper.querySelectorAll("[data-certificate-element]")].map((node) => node.dataset.certificateElement)).toEqual(["background", "title", "logo"]);
  const title = paper.querySelector('[data-certificate-element="title"]');
  expect(title.style.width).toBe("500px");
  expect(title.style.height).toBe("90px");
  expect(title.style.transform).toBe("rotate(12deg)");
  expect(title.firstChild.style.whiteSpace).toBe("pre-wrap");
  expect(title.firstChild.style.overflow).toBe("hidden");
  expect(paper.querySelector("img").style.objectFit).toBe("cover");
});

test("known record placeholders resolve per recipient without interpreting HTML", () => {
  expect(CERTIFICATE_DYNAMIC_FIELDS.map(({ key }) => key)).toEqual([
    "employeeName", "designationTitle", "divisionName", "awardTitle", "awardPeriod", "awardedOn", "signatoryName", "signatoryTitle", "certificateNumber",
  ]);
  expect(resolveCertificateText("{{ employeeName }} — {{awardTitle}} / {{certificateNumber}}", certificate))
    .toBe("Alex Santos — Service Excellence / MGB-2026-001");
  expect(resolveCertificateText("{{awardedOn}}", certificate)).toBe("Oct 18, 2026");
  expect(resolveCertificateText("{{awardPeriod}}", { ...certificate, awardPeriod: "October 2026" })).toBe("October 2026");
  expect(resolveCertificateText("{{employeeName}} {{custom}}", null)).toBe(" {{custom}}");
  renderCanvas({ template: { ...createBlankCertificateTemplate(), elements: [createCanvasElement("text", { text: "<script>alert(1)</script> {{employeeName}}" })] } });
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toBe("<script>alert(1)</script> Alex Santos");
});

test("normalization keeps separate stable IDs and bounds malformed geometry", () => {
  const design = normalizeCertificateTemplate({ version: 2, elements: [
    { id: "duplicate", type: "text", width: 5000, height: 5000, x: -30, y: 3000, opacity: 9, fontSize: 400 },
    { id: "duplicate", type: "shape", shape: "ellipse", fill: "transparent" },
    { id: "unknown", type: "unsupported" },
  ] });
  expect(design.elements).toHaveLength(2);
  expect(new Set(design.elements.map(({ id }) => id)).size).toBe(2);
  expect(design.elements[0]).toMatchObject({ width: 960, height: 679, x: 0, y: 0, opacity: 1, fontSize: 128 });
  expect(design.elements[1].fill).toBe("transparent");
  expect(normalizeCertificateTemplate(design)).toEqual(design);
});

test("duplicating an element generates its selectable ID before the editor normalizes it", () => {
  const original = createCanvasElement("text", { text: "Duplicate me" });
  const duplicate = createCanvasElement(original.type, { ...original, id: undefined, x: original.x + 20, y: original.y + 20 });
  expect(duplicate.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(duplicate.id).not.toBe(original.id);
  const saved = normalizeCertificateTemplate({ ...createBlankCertificateTemplate(), elements: [original, duplicate] });
  expect(saved.elements[1]).toEqual(duplicate);
});

test("editor content, recipient preview and export paper share the same text, images and shapes", () => {
  const template = {
    ...createBlankCertificateTemplate(),
    elements: [
      createCanvasElement("shape", { id: "frame", x: 20, y: 20, width: 920, height: 639, fill: "transparent", stroke: "#123456", strokeWidth: 5, borderRadius: 12, opacity: 0.7 }),
      createCanvasElement("text", { id: "recipient", text: "Congratulations\n{{employeeName}}", x: 100, y: 150, width: 700, height: 130, fontSize: 40, rotation: 8, color: "#456789", fontWeight: 700, letterSpacing: 2 }),
      createCanvasElement("image", { id: "logo", src: "uploads/certificate-designs/logo.webp", x: 50, y: 50, width: 125, height: 90, fit: "cover", rotation: -5 }),
    ],
  };
  const describeElements = () => [...container.querySelectorAll("[data-certificate-element]")].map((node) => ({
    id: node.dataset.certificateElement,
    x: node.style.left,
    y: node.style.top,
    width: node.style.width,
    height: node.style.height,
    transform: node.style.transform,
    content: node.firstChild.outerHTML,
  }));
  renderCanvas({ template, editable: true });
  const editorContent = describeElements();
  renderCanvas({ template });
  expect(describeElements()).toEqual(editorContent);
  act(() => root.render(<AwardCertificatePaper certificate={certificate} template={template} />));
  expect(describeElements()).toEqual(editorContent);
});

test("selection and resize controls appear only in the editor and do not change geometry", () => {
  const template = { ...createBlankCertificateTemplate(), elements: [createCanvasElement("text", { id: "custom", text: "My text", width: 400, height: 80 })] };
  const onSelectElement = jest.fn();
  const onElementPointerDown = jest.fn();
  const onElementResizePointerDown = jest.fn();
  renderCanvas({ template, editable: true, selectedElementId: "custom", onSelectElement, onElementPointerDown, onElementResizePointerDown });
  let element = container.querySelector('[data-certificate-element="custom"]');
  expect(element.style.outline).toBe("2px solid #0ea5e9");
  act(() => element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(onSelectElement).toHaveBeenCalledWith("custom");
  expect(onElementPointerDown).toHaveBeenCalledWith(expect.anything(), "custom");
  act(() => container.querySelector("[data-certificate-resize]").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(onElementResizePointerDown).toHaveBeenCalledWith(expect.anything(), "custom");
  renderCanvas({ template, selectedElementId: "custom", onElementResizePointerDown });
  element = container.querySelector('[data-certificate-element="custom"]');
  expect(element.style.width).toBe("400px");
  expect(element.style.height).toBe("80px");
  expect(element.style.outline).toBe("");
  expect(container.querySelector("[data-certificate-resize]")).toBeNull();
});

test("locked elements can be selected without starting a drag or exposing resize handles", () => {
  const template = { ...createBlankCertificateTemplate(), elements: [createCanvasElement("shape", { id: "locked", locked: true, shape: "ellipse" })] };
  const onSelectElement = jest.fn();
  const onElementPointerDown = jest.fn();
  renderCanvas({ template, editable: true, selectedElementId: "locked", onSelectElement, onElementPointerDown, onElementResizePointerDown: jest.fn() });
  act(() => container.querySelector('[data-certificate-element="locked"]').dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(onSelectElement).toHaveBeenCalledWith("locked");
  expect(onElementPointerDown).not.toHaveBeenCalled();
  expect(container.querySelector("[data-certificate-resize]")).toBeNull();
});

test("background uploads and custom lines render without preset decorations", () => {
  const template = { ...createBlankCertificateTemplate(), backgroundImage: "uploads/certificate-designs/page.webp", backgroundImageFit: "cover", elements: [createCanvasElement("shape", { id: "rule", shape: "line", stroke: "#ff0000", strokeWidth: 4 })] };
  const paper = renderCanvas({ template });
  expect(paper.querySelector("img").style.objectFit).toBe("cover");
  const rule = paper.querySelector('[data-certificate-element="rule"]').firstChild;
  expect(rule.style.height).toBe("4px");
  expect(rule.style.background).toBe("rgb(255, 0, 0)");
  expect(paper.childElementCount).toBe(2);
});
