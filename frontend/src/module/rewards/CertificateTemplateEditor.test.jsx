import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CertificateTemplateEditor from "./CertificateTemplateEditor";
import { CERTIFICATE_PRESETS, createCertificateTemplate } from "./certificateTemplate";
import { editableCertificateTemplate } from "./editableCertificateTemplate";
import { assignCertificateTemplateToCycle, createSavedCertificateTemplate, deleteSavedCertificateTemplate,
  fetchAwardCycles, fetchCertificateTemplate, updateCertificateTemplate,
  uploadCertificateDesign, uploadCertificateSignature } from "../../services/api";
import { toast } from "react-hot-toast";
import Swal from "sweetalert2";
import { registerNavigationGuard } from "../../utils/navigationGuard";

/* eslint-disable testing-library/no-unnecessary-act */

jest.mock("../../services/api", () => ({
  assignCertificateTemplateToCycle: jest.fn(), createSavedCertificateTemplate: jest.fn(),
  deleteSavedCertificateTemplate: jest.fn(), fetchAwardCycles: jest.fn(), fetchCertificateTemplate: jest.fn(),
  updateCertificateTemplate: jest.fn(), uploadCertificateDesign: jest.fn(), uploadCertificateSignature: jest.fn(),
}));
jest.mock("../../utils/navigationGuard", () => ({ registerNavigationGuard: jest.fn(() => jest.fn()) }));
jest.mock("react-hot-toast", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));
jest.mock("html2canvas", () => jest.fn());
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));

let container;
let root;
let library;
let activeLibraryId;

const libraryResponse = () => ({ success: true, templates: library, activeTemplateId: activeLibraryId,
  template: library.find((record) => record.id === activeLibraryId)?.template });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  registerNavigationGuard.mockImplementation(() => jest.fn());
  library = [{ id: "legacy", name: "Existing ceremony", template: createCertificateTemplate("classic", { title: "Historic ceremony" }) }];
  activeLibraryId = "legacy";
  fetchCertificateTemplate.mockImplementation(async () => libraryResponse());
  createSavedCertificateTemplate.mockImplementation(async ({ name, template }) => {
    const templateRecord = { id: `saved-${library.length}`, name, template };
    library = [...library, templateRecord]; activeLibraryId = templateRecord.id;
    return { ...libraryResponse(), templateRecord };
  });
  updateCertificateTemplate.mockImplementation(async (template, { templateId, name }) => {
    const templateRecord = { id: templateId, name, template };
    library = library.map((record) => record.id === templateId ? templateRecord : record);
    activeLibraryId = templateId;
    return { ...libraryResponse(), templateRecord };
  });
  deleteSavedCertificateTemplate.mockImplementation(async (id) => {
    library = library.filter((record) => record.id !== id); activeLibraryId = library[0].id;
    return libraryResponse();
  });
  fetchAwardCycles.mockResolvedValue({ cycles: [
    { id: "open", category: "Service Award", status: "ongoing", isArchived: false },
    { id: "closed", category: "Closed award", status: "closed", isArchived: false },
    { id: "archived", category: "Archived award", status: "ongoing", isArchived: true },
  ] });
  assignCertificateTemplateToCycle.mockResolvedValue({ success: true });
  uploadCertificateDesign.mockResolvedValue({ backgroundImage: "uploads/certificate-designs/custom-logo.png" });
  uploadCertificateSignature.mockResolvedValue({ signatureImage: "uploads/certificate-signatures/signature.png" });
  Swal.fire.mockResolvedValue({ isConfirmed: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderEditor() {
  await act(async () => root.render(<CertificateTemplateEditor />));
}
function button(label) {
  const found = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label
    || node.textContent.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function control(label) {
  const found = document.querySelector(`input[aria-label="${label}"],textarea[aria-label="${label}"],select[aria-label="${label}"]`);
  if (!found) throw new Error(`Missing control: ${label}`);
  return found;
}
function paper() { return container.querySelector("main [data-certificate-canvas]"); }
function objects() { return [...paper().querySelectorAll("[data-certificate-element]")]; }
async function click(label) { await act(async () => button(label).click()); }
async function change(label, value) {
  const node = control(label);
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, String(value));
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function upload(mode, file) {
  await click(mode);
  const node = control("Upload certificate image");
  Object.defineProperty(node, "files", { configurable: true, value: [file] });
  await act(async () => node.dispatchEvent(new Event("change", { bubbles: true })));
}

test("starts with empty white paper even when a saved preset design exists", async () => {
  await renderEditor();
  expect(paper().dataset.certificateVersion).toBe("2");
  expect(paper().style.background).toBe("rgb(255, 255, 255)");
  expect(paper().childElementCount).toBe(0);
  expect(control("Template name").value).toBe("Untitled certificate");
  await click("Designs");
  await click("Open design Existing ceremony");
  expect(paper().textContent).toContain("Historic ceremony");
  expect(paper().querySelectorAll("img")).toHaveLength(2);
  await click("New blank");
  expect(paper().childElementCount).toBe(0);
  expect(createSavedCertificateTemplate).not.toHaveBeenCalled();
});

test("saves user text, award fields and shapes and reopens the same design", async () => {
  await renderEditor();
  await click("Add heading");
  await change("Text content", "Certificate of excellence");
  await change("Font size", 42);
  await click("Add Recipient name field");
  expect(control("Text content").value).toBe("{{employeeName}}");
  expect(paper().textContent).toContain("Juan Dela Cruz");
  await click("Add rectangle");
  await change("Fill color", "#ffcc33");
  await click("To back");
  await change("Template name", "My own certificate");
  await click("Save design");
  const payload = createSavedCertificateTemplate.mock.calls[0][0];
  expect(payload.name).toBe("My own certificate");
  expect(payload.template.version).toBe(2);
  expect(payload.template.elements.map((element) => element.type)).toEqual(["shape", "text", "text"]);
  expect(payload.template.elements[1]).toMatchObject({ text: "Certificate of excellence", fontSize: 42 });
  expect(payload.template.elements[2].text).toBe("{{employeeName}}");
  expect(button("Save design").disabled).toBe(true);
  act(() => root.unmount()); root = createRoot(container);
  await renderEditor();
  expect(objects()).toHaveLength(0);
  await click("Designs");
  await click("Open design My own certificate");
  expect(objects()).toHaveLength(3);
  expect(paper().textContent).toBe("Certificate of excellenceJuan Dela Cruz");
});

test("duplicates, deletes, undoes and redoes an element while preserving its properties", async () => {
  await renderEditor();
  await click("Add text");
  await change("Text content", "Designed by me");
  await click("Duplicate element");
  expect(objects()).toHaveLength(2);
  expect(new Set(objects().map((node) => node.dataset.certificateElement)).size).toBe(2);
  expect(control("Text content").value).toBe("Designed by me");
  await click("Delete element");
  expect(objects()).toHaveLength(1);
  await click("Undo"); expect(objects()).toHaveLength(2);
  await click("Redo"); expect(objects()).toHaveLength(1);
  await click("Undo");
  await click("Layers");
  const layerButtons = [...document.querySelectorAll('button[aria-label="Select layer Designed by me"]')];
  await act(async () => layerButtons[0].click());
  await click("Lock element");
  expect(button("Delete element").disabled).toBe(true);
  const id = objects()[1].dataset.certificateElement;
  await act(async () => objects()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  expect(objects().map((node) => node.dataset.certificateElement)).toContain(id);
  await click("Unlock element");
  await click("Delete element"); expect(objects()).toHaveLength(1);
});

test("inserts dynamic award fields into custom wording without storing sample names", async () => {
  await renderEditor();
  await click("Add text");
  await change("Text content", "Presented to ");
  control("Text content").setSelectionRange(13, 13);
  await change("Insert award field", "employeeName");
  expect(control("Text content").value).toBe("Presented to {{employeeName}}");
  expect(paper().textContent).toBe("Presented to Juan Dela Cruz");
  await click("Save design");
  expect(createSavedCertificateTemplate.mock.calls[0][0].template.elements[0].text).toBe("Presented to {{employeeName}}");
});

test("uploads independent images, signatures and a background and saves every asset", async () => {
  await renderEditor();
  const image = new File(["logo"], "logo.png", { type: "image/png" });
  const signature = new File(["signature"], "signature.png", { type: "image/png" });
  await upload("Upload image", image);
  await upload("Upload signature", signature);
  await upload("Upload background", image);
  expect(uploadCertificateDesign).toHaveBeenCalledTimes(2);
  expect(uploadCertificateSignature).toHaveBeenCalledWith(signature);
  expect(paper().querySelectorAll("img")).toHaveLength(3);
  await click("Save design");
  expect(createSavedCertificateTemplate.mock.calls[0][0].template).toMatchObject({
    backgroundImage: "uploads/certificate-designs/custom-logo.png",
    elements: [
      { type: "image", src: "uploads/certificate-designs/custom-logo.png" },
      { type: "image", src: "uploads/certificate-signatures/signature.png" },
    ],
  });
});

test("assigns the exact current design to an open nomination without saving it first", async () => {
  await renderEditor();
  await click("Add Award name field");
  await click("Use for nomination");
  expect([...control("Open nomination").options].map((option) => option.value)).toEqual(["open"]);
  await click("Use this design");
  expect(assignCertificateTemplateToCycle).toHaveBeenCalledWith({ cycleId: "open", template: expect.objectContaining({
    version: 2, elements: [expect.objectContaining({ type: "text", text: "{{awardTitle}}" })],
  }) });
  expect(createSavedCertificateTemplate).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith("Design assigned to the nomination.");
});

test("keeps the draft after a failed save and retries without losing the design", async () => {
  await renderEditor();
  createSavedCertificateTemplate.mockRejectedValueOnce({ response: { data: { message: "Connection unavailable" } } });
  await click("Add text"); await change("Text content", "Keep my work");
  await click("Save design");
  expect(toast.error).toHaveBeenCalledWith("Connection unavailable");
  expect(paper().textContent).toBe("Keep my work");
  expect(button("Save design").disabled).toBe(false);
  await click("Save design");
  expect(createSavedCertificateTemplate).toHaveBeenCalledTimes(2);
  expect(createSavedCertificateTemplate.mock.calls[1][0].template.elements[0].text).toBe("Keep my work");
});

test("selects a ready-made template, saves a new design and reopens it from the gallery", async () => {
  await renderEditor();
  await click("Select template");
  for (const preset of CERTIFICATE_PRESETS) expect(button(`Use template ${preset.name}`)).toBeTruthy();
  await click("Use template Modern Teal");
  expect(paper().dataset.certificateVersion).toBe("2");
  expect(paper().textContent).toContain("CERTIFICATE OF RECOGNITION");
  expect(paper().textContent).toContain("Juan Dela Cruz");
  expect(control("Template name").value).toBe("Modern Teal");
  await click("Save design");
  expect(createSavedCertificateTemplate).toHaveBeenCalledWith({ name: "Modern Teal", template: editableCertificateTemplate(createCertificateTemplate("modern")) });
  expect(updateCertificateTemplate).not.toHaveBeenCalled();
  expect(library[0].template.text.title).toBe("Historic ceremony");
  await click("Design your own");
  expect(paper().childElementCount).toBe(0);
  expect(button("Add heading").closest("fieldset").disabled).toBe(false);
  await click("Select template");
  await click("Select saved design Modern Teal");
  expect(control("Template name").value).toBe("Modern Teal");
  expect(paper().textContent).toContain("CERTIFICATE OF RECOGNITION");
  expect(button("Save design").disabled).toBe(true);
});

test("protects a custom draft when choosing a preset or starting another design", async () => {
  await renderEditor();
  await click("Add text");
  await change("Text content", "Keep this draft");
  Swal.fire.mockResolvedValue({ isConfirmed: false });
  await click("Select template");
  expect(Swal.fire).not.toHaveBeenCalled();
  await click("Use template Classic Gold");
  expect(Swal.fire).toHaveBeenCalledTimes(1);
  expect(paper().textContent).toBe("Keep this draft");
  Swal.fire.mockResolvedValue({ isConfirmed: true });
  await click("Use template Classic Gold");
  expect(control("Template name").value).toBe("Classic Gold");
  Swal.fire.mockResolvedValue({ isConfirmed: false });
  await click("Design your own");
  expect(paper().textContent).toContain("CERTIFICATE OF RECOGNITION");
  Swal.fire.mockResolvedValue({ isConfirmed: true });
  await click("Design your own");
  await click("Add heading");
  expect(paper().textContent).toBe("Your heading");
});

test("assigns a selected preset to a nomination and avoids duplicate saved names", async () => {
  library.push({ id: "gold", name: "Classic Gold", template: createCertificateTemplate("classic") });
  await renderEditor();
  await click("Select template");
  await click("Use template Classic Gold");
  expect(control("Template name").value).toBe("Classic Gold 2");
  await click("Use for nomination");
  await click("Use this design");
  expect(assignCertificateTemplateToCycle).toHaveBeenCalledWith({ cycleId: "open", template: editableCertificateTemplate(createCertificateTemplate("classic")) });
});

test("edits preset wording, decorations and logos and persists changes on reopening", async () => {
  await renderEditor();
  await click("Select template");
  await click("Use template Executive Blue");
  expect(control("Text content").value).toBe("CERTIFICATE OF RECOGNITION");
  await change("Text content", "My own certificate title");
  await change("Text case", "none");
  await change("Text color", "#123456");
  await click("Layers");
  await act(async () => paper().querySelector('[data-certificate-element="decoration-1"]').dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  await change("Fill color", "#446688");
  await change("Height", 120);
  await act(async () => paper().querySelector('[data-certificate-element="leftLogo"]').dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  await upload("Replace image", new File(["logo"], "my-logo.png", { type: "image/png" }));
  await click("Save design");
  const saved = createSavedCertificateTemplate.mock.calls[0][0].template;
  expect(saved.elements.find(({ id }) => id === "title")).toMatchObject({ text: "My own certificate title", color: "#123456" });
  expect(saved.elements.find(({ id }) => id === "decoration-1")).toMatchObject({ fill: "#446688", height: 120 });
  expect(saved.elements.find(({ id }) => id === "leftLogo").src).toBe("uploads/certificate-designs/custom-logo.png");
  expect(saved.elements.find(({ id }) => id === "recipient").text).toBe("{{employeeName}}");
  await click("New blank");
  await click("Select template");
  await click("Select saved design Executive Blue");
  expect(paper().textContent).toContain("My own certificate title");
  expect(paper().querySelector('[data-certificate-element="decoration-1"]').style.height).toBe("120px");
  expect(button("Save design").disabled).toBe(true);
});

test("opens an older saved preset as editable layers and saves edits to the same record", async () => {
  await renderEditor();
  await click("Designs");
  await click("Open design Existing ceremony");
  expect(paper().dataset.certificateVersion).toBe("2");
  await click("Layers");
  await click("Select layer Historic ceremony");
  await change("Text content", "Updated ceremony");
  await click("Save design");
  expect(updateCertificateTemplate).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }), { templateId: "legacy", name: "Existing ceremony" });
  expect(library[0].template.elements.find(({ id }) => id === "title").text).toBe("Updated ceremony");
  expect(createSavedCertificateTemplate).not.toHaveBeenCalled();
});
