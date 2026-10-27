import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DeductionSettings, { DeductionModal, defaultDeductionDefinitionForm } from "./deductions";

const categories = [
  { categoryCode: "other", categoryName: "Other Deductions" },
  { categoryCode: "gsis", categoryName: "GSIS" },
];
const other = {
  id: 6001, definitionKey: "other:6001", groupKey: "other", type_name: "Equipment",
  description: "Equipment repayment", default_amount: 1250.5, is_active: 1,
};

/* eslint-disable testing-library/no-unnecessary-act */
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
async function renderPage(element) {
  await act(async () => root.render(element));
}
function panel(name) {
  return [...container.querySelectorAll("h2")].find((heading) => heading.textContent === name).closest("section");
}

test("Other Deductions shows only its three columns and keeps actions on other categories", async () => {
  const onAdd = jest.fn();
  await renderPage(<DeductionSettings categories={categories} deductionTypes={[other, {
    id: 2001, definitionKey: "gsis:2001", groupKey: "gsis", type_name: "GSIS Premium", is_active: 1,
  }]} onAdd={onAdd} />);
  const otherPanel = panel("Other Deductions");
  const headers = [...otherPanel.querySelectorAll("th")].map((header) => header.textContent);
  expect(headers).toEqual(["Deduction Name", "Description", "Amount"]);
  expect(otherPanel.textContent).toContain("₱1,250.50");
  const buttons = [...otherPanel.querySelectorAll("button")].map((button) => button.textContent);
  ["View", "Edit", "Deactivate"].forEach((label) => expect(buttons).not.toContain(label));
  const add = [...otherPanel.querySelectorAll("button")].find((button) => button.textContent === "Add");
  await act(async () => add.click());
  expect(onAdd).toHaveBeenCalledWith("other");

  const gsisHeaders = [...panel("GSIS").querySelectorAll("th")].map((header) => header.textContent);
  expect(gsisHeaders).toContain("Actions");
  expect(gsisHeaders).toContain("Computation");
});

test("adding Other Deductions exposes only name, description and amount, including zero amounts", async () => {
  const onFieldChange = jest.fn(() => jest.fn());
  const onSubmit = jest.fn((event) => event.preventDefault());
  await renderPage(<DeductionModal open groupKey="other" categories={categories}
    form={{ ...defaultDeductionDefinitionForm, type_name: "Other fee", description: "Monthly fee" }}
    onFieldChange={onFieldChange} onSubmit={onSubmit} />);
  const dialog = container.querySelector('[role="dialog"]');
  const form = dialog.querySelector("form");
  expect(form.querySelectorAll("input, textarea, select")).toHaveLength(3);
  expect(form.querySelector('[name="type_name"]').value).toBe("Other fee");
  expect(form.querySelector("textarea").value).toBe("Monthly fee");
  expect(form.querySelector('input[type="number"]').value).toBe("0.00");
  expect(form.querySelector('[role="switch"]')).toBeNull();
  expect(form.textContent).not.toContain("Advanced Computation Settings");
  expect(onFieldChange).toHaveBeenCalledWith("default_amount");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("a zero Other Deduction displays as an amount", async () => {
  await renderPage(<DeductionSettings categories={[categories[0]]} deductionTypes={[{ ...other, default_amount: 0 }]} />);
  expect(panel("Other Deductions").textContent).toContain("₱0.00");
  expect(panel("Other Deductions").textContent).not.toContain("Employee Specific");
});
