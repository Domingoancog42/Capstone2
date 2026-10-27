import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LeaveTypeSettings from "./leavetypes";

/* eslint-disable testing-library/no-unnecessary-act */
let container;
let root;
const leaveType = { id: 1, name: "Vacation Leave", code: "VL", isActive: 1 };
const onQueryChange = jest.fn();

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

test("the status can deactivate and reactivate a leave type", () => {
  const onToggleStatus = jest.fn();
  act(() => root.render(
    <LeaveTypeSettings leaveTypes={[leaveType]} onToggleStatus={onToggleStatus} onQueryChange={onQueryChange} />
  ));

  // The table and the narrow-screen cards share the same status control.
  container.querySelectorAll('[role="switch"]').forEach((control) => {
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.getAttribute("aria-label")).toBe("Vacation Leave status");
    act(() => control.click());
    expect(onToggleStatus).toHaveBeenLastCalledWith(leaveType);
  });

  const inactive = { ...leaveType, isActive: 0 };
  act(() => root.render(<LeaveTypeSettings leaveTypes={[inactive]} onToggleStatus={onToggleStatus} onQueryChange={onQueryChange} />));
  const control = container.querySelector('[role="switch"]');
  expect(control.textContent).toBe("Inactive");
  expect(control.getAttribute("aria-checked")).toBe("false");
  act(() => control.click());
  expect(onToggleStatus).toHaveBeenLastCalledWith(inactive);
});

test("status controls prevent repeat clicks while saving", () => {
  const onToggleStatus = jest.fn();
  act(() => root.render(
    <LeaveTypeSettings leaveTypes={[leaveType]} onToggleStatus={onToggleStatus} togglingId={1} onQueryChange={onQueryChange} />
  ));
  container.querySelectorAll('[role="switch"]').forEach((control) => {
    expect(control.disabled).toBe(true);
    expect(control.textContent).toBe("Saving...");
    act(() => control.click());
  });
  expect(onToggleStatus).not.toHaveBeenCalled();
});
