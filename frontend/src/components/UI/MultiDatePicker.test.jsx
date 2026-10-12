/* eslint-disable testing-library/no-unnecessary-act -- Uses the repo's native React createRoot test pattern. */
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import MultiDatePicker from "./MultiDatePicker";
import { formatDateDisplay } from "../../utils/leaveHelpers";

jest.mock("../../utils/leaveHelpers", () => ({
  ...jest.requireActual("../../utils/leaveHelpers"),
  todayDateInputValue: () => "2026-10-12",
  isPastDate: (date) => date < "2026-10-12",
}));

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const mount = async (props) => act(async () => root.render(<MultiDatePicker {...props} />));
const button = (label) => [...container.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === label);
const click = async (element) => {
  expect(element).toBeTruthy();
  await act(async () => element.click());
};
const openPicker = () => click(container.querySelector("button"));

test("CTO month lock disables both arrows and permits earlier weekdays within the current month", async () => {
  const onChange = jest.fn();
  await mount({ minDate: "", currentMonthOnly: true, onChange });
  await openPicker();
  expect(container.textContent).toContain("October 2026");
  expect(button("Previous month").disabled).toBe(true);
  expect(button("Next month").disabled).toBe(true);
  await click(button("Previous month"));
  await click(button("Next month"));
  expect(container.textContent).toContain("October 2026");
  expect(onChange).not.toHaveBeenCalled();
  expect(button(formatDateDisplay("2026-10-11")).disabled).toBe(true);
  expect(button(formatDateDisplay("2026-10-07")).disabled).toBe(false);
  await click(button(formatDateDisplay("2026-10-07")));
  expect(onChange).toHaveBeenCalledWith([{ date: "2026-10-07", portion: "whole" }]);
});

test("current-month calendars discard supplied dates from other months", async () => {
  const onChange = jest.fn();
  await mount({
    minDate: "", currentMonthOnly: true, onChange,
    value: ["2026-09-30", "2026-10-07", "2026-11-02"],
  });
  expect(onChange).toHaveBeenCalledWith([{ date: "2026-10-07", portion: "whole" }]);
  await openPicker();
  expect(container.textContent).toContain("October 2026");
  expect(container.textContent).not.toContain(formatDateDisplay("2026-09-30"));
  expect(container.textContent).not.toContain(formatDateDisplay("2026-11-02"));
});

function PassDatePicker({ onChange }) {
  const [selectedDays, setSelectedDays] = useState([]);
  return <MultiDatePicker value={selectedDays} currentMonthOnly selectionMode="single" allowWeekends closeOnSelect onChange={(days) => {
    setSelectedDays(days);
    onChange(days);
  }} />;
}

test("Pass Slip selects one date, rejects past days, and closes after selecting", async () => {
  const onChange = jest.fn();
  await act(async () => root.render(<PassDatePicker onChange={onChange} />));
  await openPicker();
  expect(button("Previous month").disabled).toBe(true);
  expect(button("Next month").disabled).toBe(true);
  expect(button(formatDateDisplay("2026-10-09")).disabled).toBe(true);
  await click(button(formatDateDisplay("2026-10-09")));
  expect(onChange).not.toHaveBeenCalled();
  await click(button(formatDateDisplay("2026-10-17")));
  expect(onChange).toHaveBeenLastCalledWith([{ date: "2026-10-17", portion: "whole" }]);
  expect(button("Next month")).toBeUndefined();
  await openPicker();
  expect(container.querySelector("select")).toBeNull();
  await click(button(formatDateDisplay("2026-10-19")));
  expect(onChange).toHaveBeenLastCalledWith([{ date: "2026-10-19", portion: "whole" }]);
  expect(button("Next month")).toBeUndefined();
});

test("other callers can still navigate months and select a range across months", async () => {
  const onChange = jest.fn();
  await mount({ selectionMode: "range", onChange });
  await openPicker();
  await click(button(formatDateDisplay("2026-10-30")));
  expect(button("Next month").disabled).toBe(false);
  await click(button("Next month"));
  expect(container.textContent).toContain("November 2026");
  await click(button(formatDateDisplay("2026-11-02")));
  expect(onChange).toHaveBeenLastCalledWith([
    { date: "2026-10-30", portion: "whole" },
    { date: "2026-11-02", portion: "whole" },
  ]);
});
