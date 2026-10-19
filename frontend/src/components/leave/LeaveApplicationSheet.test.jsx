import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LeaveApplicationSheet, { printLeaveApplicationSheet } from "./LeaveApplicationSheet";

jest.mock("../UI/FormQrCode", () => () => null);
jest.mock("../../utils/formSheetPdf", () => ({ downloadFormSheetPdf: jest.fn() }));

// The suite uses React's createRoot directly, so act is required for each render.
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
  jest.restoreAllMocks();
});

const applicant = {
  signatureDataUrl: "data:image/png;base64,applicant",
  fallbackText: "Applicant signing timestamp",
};
const hrmo = {
  signed: true,
  signatureDataUrl: "data:image/png;base64,hrmo",
  fallbackText: "HR signing timestamp",
  name: "HR Name",
  caption: "HR Head",
};
const chief = {
  signed: true,
  signatureDataUrl: "data:image/png;base64,chief",
  fallbackText: "Chief signing timestamp",
  name: "Chief Name",
  caption: "Division Chief",
};
const regionalDirector = {
  signed: true,
  signatureDataUrl: "data:image/png;base64,director",
  fallbackText: "Director signing timestamp",
  name: "Director Name",
};

function renderSheet(props = {}) {
  act(() => root.render(
    <LeaveApplicationSheet
      formData={{ applicantName: "Applicant Name", recommendation: "approved" }}
      applicant={applicant}
      hrmo={hrmo}
      chief={chief}
      regionalDirector={regionalDirector}
      {...props}
    />,
  ));
}

test.each([
  [true, true],
  [false, true],
  [true, false],
  [false, false],
])("independently applies e-signature=%s and timestamp=%s to every signing block", (showESignatures, showTimestamps) => {
  renderSheet({ showESignatures, showTimestamps });

  expect(container.querySelectorAll('img[alt$=" signature"]')).toHaveLength(showESignatures ? 4 : 0);
  expect(container.textContent.match(/signing timestamp/g) || []).toHaveLength(showTimestamps ? 4 : 0);
  ["Applicant Name", "HR Name", "Chief Name", "Director Name"].forEach((name) => {
    expect(container.textContent).toContain(name);
  });
  const approvalCheckbox = Array.from(container.querySelectorAll('input[type="checkbox"]'))
    .find((input) => input.parentElement.textContent === "For approval");
  expect(approvalCheckbox.checked).toBe(true);
});

test("retains empty approval lines and captions before signatories have acted", () => {
  renderSheet({ hrmo: { caption: "HR Head" }, chief: { caption: "Division Chief" }, regionalDirector: {} });

  expect(container.textContent).toContain("HR Head");
  expect(container.textContent).toContain("Division Chief");
  expect(container.textContent).toContain("OIC, Regional Director");
  expect(container.querySelectorAll(".leave-print-sign")).toHaveLength(4);
  expect(container.querySelectorAll('img[alt$=" signature"]')).toHaveLength(0);
});

test("prints the same hidden signatures and timestamps while keeping signatory names", () => {
  renderSheet();
  const printDocument = {
    write: jest.fn(),
    close: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    images: [],
  };
  jest.spyOn(window, "open").mockReturnValue({ document: printDocument });
  jest.spyOn(window, "setTimeout").mockImplementation(() => 1);

  printLeaveApplicationSheet(container.firstElementChild);

  const printedHtml = printDocument.write.mock.calls[0][0];
  expect(printedHtml).not.toContain("data:image/png;base64,");
  expect(printedHtml).not.toContain("signing timestamp");
  expect(printedHtml).toContain("HR Name");
  expect(printedHtml).toContain("Director Name");
});
