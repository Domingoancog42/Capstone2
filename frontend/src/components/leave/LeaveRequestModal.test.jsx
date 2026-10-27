import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LeaveRequestModal from "./LeaveRequestModal";
import { fetchLeaveTypes } from "../../services/leaveService";

jest.mock("../../services/leaveService", () => ({ fetchLeaveTypes: jest.fn() }));
jest.mock("./LeaveMonetizationFields", () => () => null);
jest.mock("../UI/MultiDatePicker", () => () => null);
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));

/* eslint-disable testing-library/no-unnecessary-act */
const user = { role: "employee", full_name: "Test Employee", gender: "Female" };
let container;
let root;

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderForm(open = true) {
  await act(async () => root.render(<LeaveRequestModal open={open} user={user} />));
}

function typeChoices() {
  act(() => document.querySelector('#leave-request-type').click());
  return [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
}

test("filing offers active standard and custom types and refreshes after settings change", async () => {
  fetchLeaveTypes.mockResolvedValueOnce({
    leaveTypes: [{ name: "Sick Leave" }, { name: "Wellness Leave" }, { name: "Paternity Leave" }],
  });
  await renderForm();
  const choices = typeChoices();

  expect(choices).not.toContain("Vacation Leave");
  expect(choices).toContain("Sick Leave");
  expect(choices).toContain("Wellness Leave");
  expect(choices).not.toContain("Paternity Leave");
  expect(choices).toContain("Monetization of Leave Credits");

  await renderForm(false);
  fetchLeaveTypes.mockResolvedValueOnce({ leaveTypes: [{ name: "Vacation Leave" }] });
  await renderForm();
  const updatedChoices = typeChoices();

  expect(fetchLeaveTypes).toHaveBeenCalledTimes(2);
  expect(updatedChoices).toContain("Vacation Leave");
  expect(updatedChoices).not.toContain("Sick Leave");
});

test("a load failure does not fall back to inactive hard-coded types", async () => {
  fetchLeaveTypes.mockRejectedValueOnce(new Error("Unavailable"));
  await renderForm();
  expect(document.querySelector('[role="alert"]').textContent).toContain("Unable to load leave types");
  const choices = typeChoices();
  expect(choices).not.toContain("Vacation Leave");
  expect(choices).not.toContain("Sick Leave");
});

test("no active leave types leaves the leave choices empty", async () => {
  fetchLeaveTypes.mockResolvedValueOnce({ leaveTypes: [] });
  await renderForm();
  expect(typeChoices()).toEqual(["Select Leave Type", "Monetization of Leave Credits"]);
});
