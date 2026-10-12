import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "react-hot-toast";
import EmployeeDocumentUploadFields from "./EmployeeDocumentUploadFields";

// React DOM's root.render needs act; these tests do not use Testing Library.
/* eslint-disable testing-library/no-unnecessary-act */

jest.mock("react-hot-toast", () => ({ toast: { error: jest.fn() } }));

test("selects multiple documents by type, rejects invalid files, and removes queued attachments", () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = jest.fn();
  act(() => root.render(<EmployeeDocumentUploadFields onChange={onChange} />));
  expect(container.textContent).toContain("Birth Certificate");
  expect(container.textContent).toContain("Valid IDs");
  expect(container.textContent).toContain("Diploma");
  expect(container.textContent).not.toContain("Resume");
  act(() => container.querySelector('[aria-label="Upload Valid IDs"]').click());
  const input = container.querySelector('input[type="file"]');
  const first = new File(["id"], "id.pdf");
  const second = new File(["photo"], "passport.png");
  Object.defineProperty(input, "files", { configurable: true, value: [first, second, new File(["bad"], "script.exe")] });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  const attachments = [{ documentType: "valid_id", file: first }, { documentType: "valid_id", file: second }];
  expect(onChange).toHaveBeenLastCalledWith(attachments);
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("script.exe"));
  act(() => root.render(<EmployeeDocumentUploadFields value={attachments} onChange={onChange} />));
  act(() => container.querySelector('[aria-label="Remove id.pdf"]').click());
  expect(onChange).toHaveBeenLastCalledWith([attachments[1]]);
  act(() => root.render(<EmployeeDocumentUploadFields value={attachments} onChange={onChange} disabled />));
  expect(container.querySelector('[aria-label="Upload Valid IDs"]').disabled).toBe(true);
  expect(input.disabled).toBe(true);
  act(() => root.unmount());
  container.remove();
});
