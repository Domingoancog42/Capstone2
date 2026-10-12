import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OvertimeWorkDateCalendar from "./OvertimeWorkDateCalendar";
import { fetchHolidays } from "../../services/holidayService";
import { todayDateInputValue } from "../../utils/leaveHelpers";
import { useAutoRefreshOnChange } from "../../components/auto/autorefreshdatalist";

jest.mock("../../services/holidayService", () => ({ fetchHolidays: jest.fn() }));
jest.mock("../../utils/leaveHelpers", () => ({ todayDateInputValue: jest.fn() }));
jest.mock("../../components/auto/autorefreshdatalist", () => ({ useAutoRefreshOnChange: jest.fn() }));

let container;
let root;
const button = (name) => Array.from(container.querySelectorAll("button")).find((node) => (node.getAttribute("aria-label") || node.textContent).includes(name));
const click = (node) => act(async () => node.click());
// React DOM's root.render needs act; this is not a Testing Library render helper.
// eslint-disable-next-line testing-library/no-unnecessary-act
const mountCalendar = (props) => act(async () => root.render(<OvertimeWorkDateCalendar onChange={() => {}} value="" {...props} />));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  todayDateInputValue.mockReturnValue("2026-10-10");
  fetchHolidays.mockResolvedValue({ holidays: [{ date: "2026-10-11", name: "Office special day", type: "special_non_working" }] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("shows weekdays and today, prevents past selection, and selects a future work date", async () => {
  const onChange = jest.fn();
  await mountCalendar({ onChange });
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach((day) => expect(container.textContent).toContain(day));
  expect(button("Friday, October 9, 2026").disabled).toBe(true);
  await click(button("Friday, October 9, 2026"));
  expect(onChange).not.toHaveBeenCalled();
  expect(button("Saturday, October 10, 2026").getAttribute("aria-current")).toBe("date");
  await click(button("Monday, October 12, 2026"));
  expect(onChange).toHaveBeenCalledWith("2026-10-12");
  await mountCalendar({ value: "2026-10-12", onChange });
  expect(button("Monday, October 12, 2026").getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toContain("Selected: Monday, October 12, 2026");
});

test("disables light gray weekends, keeps holidays visible, and allows weekday holiday selection", async () => {
  const onChange = jest.fn();
  fetchHolidays.mockResolvedValue({ holidays: [
    { date: "2026-10-11", name: "Office special day", type: "special_non_working" },
    { date: "2026-10-12", name: "Office holiday", type: "special_non_working" },
  ] });
  await mountCalendar({ onChange });
  expect(container.textContent).toContain("Office special day");
  expect(button("Sunday, October 11, 2026, Office special day").disabled).toBe(true);
  expect(button("Sunday, October 11, 2026, Office special day").classList.contains("bg-gray-200")).toBe(true);
  expect(button("Saturday, October 17, 2026").disabled).toBe(true);
  expect(button("Saturday, October 17, 2026").classList.contains("bg-gray-200")).toBe(true);
  await click(button("Sunday, October 11, 2026, Office special day"));
  await click(button("Saturday, October 17, 2026"));
  expect(onChange).not.toHaveBeenCalled();
  await click(button("Monday, October 12, 2026, Office holiday"));
  expect(onChange).toHaveBeenCalledWith("2026-10-12");
});

test("always displays the current month and prevents navigation or selecting another month", async () => {
  const onChange = jest.fn();
  await mountCalendar({ value: "2026-11-02", onChange });
  expect(container.querySelector('[aria-label="Calendar month"]').textContent).toBe("October 2026");
  expect(container.querySelector('input[type="month"]')).toBeNull();
  expect(button("Previous month").disabled).toBe(true);
  expect(button("Next month").disabled).toBe(true);
  await click(button("Previous month"));
  await click(button("Next month"));
  expect(container.querySelector('[aria-label="Calendar month"]').textContent).toBe("October 2026");
  expect(container.textContent).not.toContain("Selected:");
  expect(onChange).not.toHaveBeenCalled();
  await mountCalendar({ value: "2026-09-01", onChange });
  expect(container.querySelector('[aria-label="Calendar month"]').textContent).toBe("October 2026");
});

test("refreshes holiday changes using the existing live feed", async () => {
  await mountCalendar();
  const [refresh, options] = useAutoRefreshOnChange.mock.calls.at(-1);
  expect(options.topic).toBe("holiday");
  fetchHolidays.mockResolvedValue({ holidays: [{ date: "2026-10-12", name: "Office holiday", type: "special_non_working" }] });
  await act(async () => { await refresh({ background: true }); });
  expect(container.textContent).toContain("Office holiday");
  expect(container.textContent).not.toContain("Office special day");
});

test("shows loading failures and recovers on retry without blocking date selection", async () => {
  fetchHolidays.mockRejectedValueOnce(new Error("offline"));
  const onChange = jest.fn();
  await mountCalendar({ onChange, error: "Select a work date on the calendar." });
  expect(container.textContent).toContain("Holidays could not be refreshed");
  expect(container.querySelector('[role="alert"]').textContent).toContain("Select a work date");
  await click(button("Monday, October 12, 2026"));
  expect(onChange).toHaveBeenCalledWith("2026-10-12");
  await click(button("Retry"));
  expect(container.textContent).not.toContain("Holidays could not be refreshed");
});

test("automatically follows the current month at year rollover and ignores stale holiday responses", async () => {
  let resolveOldRequest;
  todayDateInputValue.mockReturnValue("2026-12-01");
  fetchHolidays.mockImplementationOnce(() => new Promise((resolve) => { resolveOldRequest = resolve; }));
  await mountCalendar({ value: "2026-12-01" });
  fetchHolidays.mockResolvedValue({ holidays: [{ date: "2027-01-01", name: "New Year", type: "regular" }] });
  todayDateInputValue.mockReturnValue("2027-01-01");
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => resolveOldRequest({ holidays: [{ date: "2027-01-01", name: "Stale holiday", type: "regular" }] }));
  expect(container.textContent).toContain("New Year");
  expect(container.textContent).not.toContain("Stale holiday");
  expect(container.querySelector('[aria-label="Calendar month"]').textContent).toBe("January 2027");
  expect(fetchHolidays).toHaveBeenLastCalledWith({ start: "2027-01-01", end: "2027-12-31" });
});
