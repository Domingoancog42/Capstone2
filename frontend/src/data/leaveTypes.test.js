import { mergeCscLeaveTypes } from "./leaveTypes";

test("the form checklist only includes active configured types in CSC order", () => {
  expect(mergeCscLeaveTypes([
    { name: "Wellness Leave", isActive: 1 },
    { name: "Sick Leave", isActive: "1" },
    { name: "Vacation Leave", isActive: 0 },
    { name: "Adoption Leave", isActive: 1 },
    { name: "Wellness Leave", isActive: 1 },
  ])).toEqual(["Sick Leave", "Adoption Leave", "Wellness Leave"]);
});

test("an empty active list never restores the hard-coded checklist", () => {
  expect(mergeCscLeaveTypes([])).toEqual([]);
});

test("reactivating a standard type restores its checklist entry", () => {
  expect(mergeCscLeaveTypes([{ name: "Vacation Leave", isActive: 1 }]))
    .toEqual(["Vacation Leave"]);
});
