import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProfilePage from "./ProfilePage";
import { createEmptyPdsProfile, getPdsProfile, savePdsEligibility, savePdsTraining } from "../../services/pdsProfileService";
import { downloadPersonalDataSheet } from "../../services/personalDataSheetService";
import { toast } from "react-hot-toast";
import * as profileApi from "../../services/api";
import { fetchProfileEditRequestStatus } from "../../services/profileEditRequestService";

// Use the installed React DOM test APIs, matching the other component tests.
/* eslint-disable testing-library/no-unnecessary-act */
jest.mock("../../services/api", () => ({
  getEmployees: jest.fn(async () => ({ employees: [{ id: 1, employeeId: "TEST-001", firstName: "Test", lastName: "User", email: "test@example.test" }] })),
  getEmployeeOptions: jest.fn(async () => ({})), getUsers: jest.fn(async () => ({ users: [] })),
  getEmployeeSignature: jest.fn(async () => ({})), fetchServiceRecord: jest.fn(async () => ({ records: [] })),
  getTwoFactorProfile: jest.fn(async () => ({})), checkPasswordExpiry: jest.fn(async () => ({})),
}));
jest.mock("../../services/pdsProfileService", () => ({
  ...jest.requireActual("../../services/pdsProfileService"),
  getPdsProfile: jest.fn(), savePdsFamily: jest.fn(), savePdsEducation: jest.fn(), savePdsEligibility: jest.fn(), savePdsTraining: jest.fn(),
}));
jest.mock("../../services/personalDataSheetService", () => ({ downloadPersonalDataSheet: jest.fn(async () => {}) }));
jest.mock("../../services/profileEditRequestService", () => ({ fetchProfileEditRequestStatus: jest.fn(async () => ({ canEditDirectly: true })) }));
jest.mock("../../hooks/useAddressDirectory", () => () => ({ regions: [], provinces: [], cities: [], barangays: [] }));
jest.mock("../auto/autorefreshdatalist", () => ({ useAutoRefreshOnChange: () => {} }));
jest.mock("../../utils/navigationGuard", () => ({ registerNavigationGuard: () => () => {} }));
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));
jest.mock("framer-motion", () => ({
  AnimatePresence: ({ children }) => children,
  motion: { div: ({ children, className }) => <div className={className}>{children}</div>, span: ({ children, className }) => <span className={className}>{children}</span> },
}));
jest.mock("react-hot-toast", () => {
  const toast = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), loading: jest.fn() });
  return { toast };
});

const user = { id: 1, employee_id: "TEST-001", email: "test@example.test", role: "employee" };
let saved, root, container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo = jest.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  profileApi.getEmployees.mockResolvedValue({ employees: [{ id: 1, employeeId: "TEST-001", firstName: "Test", lastName: "User", email: "test@example.test" }] });
  for (const name of ["getEmployeeOptions", "getEmployeeSignature", "getTwoFactorProfile", "checkPasswordExpiry"]) {
    profileApi[name].mockResolvedValue({});
  }
  profileApi.getUsers.mockResolvedValue({ users: [] });
  profileApi.fetchServiceRecord.mockResolvedValue({ records: [] });
  fetchProfileEditRequestStatus.mockResolvedValue({ canEditDirectly: true });
  downloadPersonalDataSheet.mockResolvedValue(undefined);
  saved = createEmptyPdsProfile();
  getPdsProfile.mockImplementation(async () => JSON.parse(JSON.stringify(saved)));
  for (const [section, save] of [["eligibility", savePdsEligibility], ["training", savePdsTraining]]) {
    save.mockImplementation(async (records) => {
      saved = { ...saved, [section]: records.map((record, index) => ({ ...record, id: index + 1 })) };
      return JSON.parse(JSON.stringify(saved));
    });
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function mount(tab) {
  await act(async () => root.render(<ProfilePage user={user} initialTab={tab} />));
}
function button(name) {
  const node = [...container.querySelectorAll("button")].find((item) => item.textContent.trim() === name || item.getAttribute("aria-label") === name);
  if (!node) throw new Error(`Missing button: ${name}; ${container.textContent.slice(0, 350)}`);
  return node;
}
async function click(name) {
  await act(async () => button(name).click());
}
function input(label) {
  const node = [...container.querySelectorAll("label")].find((item) => label instanceof RegExp ? label.test(item.textContent) : item.textContent.trim() === label);
  if (!node) throw new Error(`Missing field: ${label}`);
  return container.querySelector(`[id="${node.htmlFor}"]`);
}
async function change(label, value) {
  await act(async () => {
    const node = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("adds both PDS sections, saves drafts across tabs, reloads them, and removes entries", async () => {
  await mount("eligibility");
  await click("Edit Profile");
  await click("Add Eligibility");
  await change(/Career Service/, "Career Service Professional");
  await change(/License Number/, "0000123");
  await click("Learning & Development");
  await click("Add Training");
  await change(/Title of L&D/, "Records Management");
  await change("From", "2026-01-02");
  await change("To", "2026-01-04");
  await change("Number of Hours", "0");
  await click("Save Changes");
  expect(button("Edit Profile")).toBeTruthy();
  expect(savePdsEligibility).toHaveBeenCalledWith([expect.objectContaining({ eligibilityName: "Career Service Professional", licenseNumber: "0000123" })]);
  expect(savePdsTraining).toHaveBeenCalledWith([expect.objectContaining({ title: "Records Management", hours: "0" })]);
  expect(input("Number of Hours").disabled).toBe(true);
  await click("Export PDS Excel");
  expect(downloadPersonalDataSheet).toHaveBeenCalledWith(expect.any(Object), { format: "xlsx" });
  await click("Download PDS PDF");
  expect(downloadPersonalDataSheet).toHaveBeenCalledWith(expect.any(Object), { format: "pdf" });
  act(() => root.unmount());
  root = createRoot(container);
  await mount("training");
  expect(input(/Title of L&D/).value).toBe("Records Management");
  await click("Civil Service Eligibility");
  expect(input(/License Number/).value).toBe("0000123");
  await click("Edit Profile");
  await click("Remove eligibility 1");
  await click("Save Changes");
  expect(saved.eligibility).toEqual([]);
  expect(saved.training[0].title).toBe("Records Management");
});

test("rejects invalid training dates and cancels edits without saving", async () => {
  await mount("training");
  await click("Edit Profile");
  await click("Add Training");
  await change(/Title of L&D/, "Safety Training");
  await change("From", "2026-02-04");
  await change("To", "2026-02-02");
  await click("Save Changes");
  expect(savePdsTraining).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("End date must be on or after the start date.");
  await click("Cancel");
  expect(container.querySelector('input[name="training-0-title"]')).toBeNull();
  expect(saved.training).toEqual([]);
});

test("a later save failure retains unsaved drafts and preserves already saved sections on cancel", async () => {
  await mount("eligibility");
  await click("Edit Profile");
  await click("Add Eligibility");
  await change(/Career Service/, "Board Exam");
  await click("Learning & Development");
  await click("Add Training");
  await change(/Title of L&D/, "Pending Training");
  savePdsTraining.mockRejectedValueOnce(new Error("Save failed"));
  await click("Save Changes");
  expect(toast.error).toHaveBeenCalledWith("Save failed");
  expect(input(/Title of L&D/).value).toBe("Pending Training");
  await click("Cancel");
  expect(container.querySelector('input[name="training-0-title"]')).toBeNull();
  await click("Civil Service Eligibility");
  expect(input(/Career Service/).value).toBe("Board Exam");
});

test("failed PDS loading keeps its entries read-only so existing records cannot be replaced with an empty draft", async () => {
  getPdsProfile.mockRejectedValueOnce(new Error("Network error"));
  await mount("eligibility");
  await click("Edit Profile");
  expect(container.querySelector('[role="alert"]').textContent).toContain("Unable to load your saved PDS details");
  expect([...container.querySelectorAll("button")].some((node) => node.textContent.includes("Add Eligibility"))).toBe(false);
  expect(savePdsEligibility).not.toHaveBeenCalled();
});
