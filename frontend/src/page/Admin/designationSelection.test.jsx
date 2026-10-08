import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CreateEmployee from "./create_employee";

test("choosing a designation displays it in Add New Employee", () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CreateEmployee options={{
    divisions: [{ id: 2, name: "Finance & Administrative Management" }],
    designations: [],
    designationSuggestions: [{ name: "Chief, Administrative Section", division: "Finance & Administrative Management" }],
  }} nextEmployeeId="TEST-001" />));
  const field = container.querySelector('input[name="designation"]');
  act(() => field.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((node) => node.textContent === "Chief, Administrative Section");
  expect(option).toBeTruthy();
  act(() => option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  act(() => option.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(field.value).toBe("Chief, Administrative Section");
  expect(document.querySelector('[role="listbox"][aria-label="Designation"]')).toBeNull();
  act(() => root.unmount());
  container.remove();
});
