import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AccomplishmentMemoPaper, printAccomplishmentMemo } from "./AccomplishmentReportMemo";
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));

const memo = {
  employeeName: "Alex Applicant",
  employeeSignature: "data:image/png;base64,applicant-ink",
  submittedAt: "2026-10-01 09:00:00",
  notedByName: "Charlie Chief",
  chiefSignature: "data:image/png;base64,chief-ink",
  notedAt: "2026-10-02 10:00:00",
};

let container;
let root;
// These tests use a React DOM root directly.
// eslint-disable-next-line testing-library/no-unnecessary-act
const mount = (props = {}) => act(() => root.render(<AccomplishmentMemoPaper {...memo} {...props} />));

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

test.each([
  [true, true],
  [true, false],
  [false, true],
  [false, false],
])("accomplishment memo honors e-signatures=%s and timestamps=%s independently", (showESignatures, showTimestamps) => {
  mount({ showESignatures, showTimestamps });

  expect(container.querySelectorAll('img[alt$=" signature"]')).toHaveLength(showESignatures ? 2 : 0);
  const timestamps = Array.from(container.querySelectorAll("p")).filter((node) => /^(Submitted|Noted): /.test(node.textContent));
  expect(timestamps).toHaveLength(showTimestamps ? 2 : 0);
  expect(container.textContent).toContain("Alex Applicant");
  expect(container.textContent).toContain("Charlie Chief");
  expect(container.textContent).toContain("Printed Name and Signature of");
});

test("printed accomplishment memo retains the names while omitting disabled ink and timestamps", () => {
  const paperRef = React.createRef();
  mount({ paperRef, showESignatures: false, showTimestamps: false });
  const printWindow = {
    document: { write: jest.fn(), close: jest.fn(), querySelector: jest.fn(), images: [] },
    focus: jest.fn(), print: jest.fn(), addEventListener: jest.fn(), close: jest.fn(),
  };
  const openWindow = jest.spyOn(window, "open").mockReturnValue(printWindow);
  printAccomplishmentMemo(paperRef.current);
  const printedHtml = printWindow.document.write.mock.calls[0][0];
  expect(printedHtml).toContain("Alex Applicant");
  expect(printedHtml).toContain("Charlie Chief");
  expect(printedHtml).not.toContain("applicant-ink");
  expect(printedHtml).not.toContain("chief-ink");
  expect(printedHtml).not.toContain("Submitted:");
  expect(printedHtml).not.toContain("Noted:");
  openWindow.mockRestore();
});
