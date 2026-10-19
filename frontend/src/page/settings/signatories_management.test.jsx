import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SignatoriesManagement from "./signatories_management";
import { getFilingSignatories, saveFilingSignatories } from "../../services/api";
import { isKnownAppPath, isPathAllowedForRole } from "../../utils/roleRoutes";
import { userCanAccessModule } from "../../utils/permissions";

jest.mock("../../services/api", () => ({
  getFilingSignatories: jest.fn(),
  saveFilingSignatories: jest.fn(),
}));

const enabled = { showTimestamps: true, showESignatures: true };
const admin = { roleKey: "admin", permissions: { settings: ["view", "edit"] } };

/* eslint-disable testing-library/no-unnecessary-act */
let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  getFilingSignatories.mockResolvedValue({ filingSignatories: enabled });
  saveFilingSignatories.mockImplementation(async (settings) => ({ filingSignatories: settings }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPage(user = admin) {
  await act(async () => root.render(<SignatoriesManagement user={user} />));
}

function switchFor(label) {
  return container.querySelector(`[role="switch"][aria-label="${label}"]`);
}

function saveButton() {
  return container.querySelector('button[type="submit"]');
}

async function click(button) {
  await act(async () => button.click());
}

test.each([
  ["Show timestamps", { showTimestamps: false, showESignatures: true }],
  ["Show e-signatures", { showTimestamps: true, showESignatures: false }],
])("saves %s independently and loads the saved policy on reopening", async (label, expected) => {
  await renderPage();
  expect(saveButton().disabled).toBe(true);
  await click(switchFor(label));
  await click(saveButton());
  expect(container.textContent).toContain("Signatory settings saved successfully.");
  expect(saveFilingSignatories).toHaveBeenCalledWith(expected);
  expect(saveButton().disabled).toBe(true);
  act(() => root.unmount());
  root = createRoot(container);

  getFilingSignatories.mockResolvedValue({ filingSignatories: expected });
  await renderPage();
  expect(switchFor(label).getAttribute("aria-checked")).toBe("false");
});

test("allows disabling both controls and preserves the draft when saving fails", async () => {
  saveFilingSignatories.mockRejectedValueOnce({ response: { data: { message: "Save failed" } } });
  await renderPage();
  await click(switchFor("Show timestamps"));
  await click(switchFor("Show e-signatures"));
  await click(saveButton());
  expect(container.querySelector('[role="alert"]').textContent).toContain("Save failed");
  expect(switchFor("Show timestamps").getAttribute("aria-checked")).toBe("false");
  expect(switchFor("Show e-signatures").getAttribute("aria-checked")).toBe("false");
  await click(saveButton());
  expect(container.textContent).toContain("Signatory settings saved successfully.");
  expect(saveFilingSignatories).toHaveBeenLastCalledWith({ showTimestamps: false, showESignatures: false });
});

test("reports a failed load and retries without allowing a save of unknown settings", async () => {
  getFilingSignatories.mockRejectedValueOnce(new Error("Network error"));
  await renderPage();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(saveButton()).toBeNull();
  await click(container.querySelector("button"));
  expect(switchFor("Show timestamps").getAttribute("aria-checked")).toBe("true");
});

test.each([
  { roleKey: "admin", permissions: { settings: ["view"] } },
  { roleKey: "employee", permissions: { settings: ["view", "edit"] } },
])("disables edits when the user lacks administrator edit access", async (user) => {
  await renderPage(user);
  expect(switchFor("Show timestamps").disabled).toBe(true);
  expect(switchFor("Show e-signatures").disabled).toBe(true);
  expect(saveButton().disabled).toBe(true);
  expect(saveFilingSignatories).not.toHaveBeenCalled();
});

test("registers the page for admin routing and the settings permission", () => {
  expect(isKnownAppPath("/admin/signatories")).toBe(true);
  expect(isPathAllowedForRole("/admin/signatories", "admin")).toBe(true);
  expect(isPathAllowedForRole("/admin/signatories", "employee")).toBe(false);
  expect(userCanAccessModule(admin, "signatories")).toBe(true);
  expect(userCanAccessModule({ permissions: {} }, "signatories")).toBe(false);
});
