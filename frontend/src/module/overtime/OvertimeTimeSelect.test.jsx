import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OvertimeTimeSelect, { isAllowedOvertimeTime } from "./OvertimeTimeSelect";

// These tests use React DOM directly; root.render requires act.
/* eslint-disable testing-library/no-unnecessary-act */

test("time picker offers only 5 PM through 9 PM and sends the selected time", () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = jest.fn();
  act(() => root.render(<OvertimeTimeSelect name="timeStart" label="Time Start" value="" onChange={onChange} />));
  const select = container.querySelector("select");
  const options = Array.from(select.options).filter((option) => option.value);
  expect(options.length).toBe(241);
  expect(options[0].textContent).toBe("5:00 PM");
  expect(options.at(-1).textContent).toBe("9:00 PM");
  expect(options.every((option) => option.value >= "17:00" && option.value <= "21:00")).toBe(true);
  act(() => {
    select.value = "18:30";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  act(() => root.render(<OvertimeTimeSelect name="timeStart" label="Time Start" value="09:00" onChange={onChange} />));
  expect(select.value).toBe("");
  expect(select.checkValidity()).toBe(false);
  act(() => root.unmount());
  container.remove();
});

test("time validation accepts the boundaries and minute precision and rejects other times", () => {
  ["17:00", "17:01", "18:30", "20:59", "21:00"].forEach((time) => expect(isAllowedOvertimeTime(time)).toBe(true));
  ["", "09:00", "16:59", "21:01", "23:00", "invalid"].forEach((time) => expect(isAllowedOvertimeTime(time)).toBe(false));
});
