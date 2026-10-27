import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LeaveAttachmentPreview, { getLeaveAttachmentPreviewInfo } from "./LeaveAttachmentPreview";
import { fetchBackendFileBlob } from "../../utils/downloadBackendFile";

jest.mock("../../utils/downloadBackendFile", () => ({
  fetchBackendFileBlob: jest.fn(),
  downloadBackendFile: jest.fn(),
}));

/* eslint-disable testing-library/no-unnecessary-act */
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let container;
let root;
let objectUrlNumber;

beforeEach(() => {
  jest.clearAllMocks();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  objectUrlNumber = 0;
  URL.createObjectURL = jest.fn(() => `blob:attachment-${++objectUrlNumber}`);
  URL.revokeObjectURL = jest.fn();
  fetchBackendFileBlob.mockResolvedValue(new Blob(["certificate"], { type: "image/png" }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

async function renderPreview(props = {}) {
  await act(async () => root.render(
    <section style={{ transform: "translateY(12px)", overflow: "hidden", height: 100 }}>
      <LeaveAttachmentPreview
        open
        attachmentName="Medical certificate.png"
        attachmentPath="uploads/leave-attachments/certificate.png"
        onClose={jest.fn()}
        {...props}
      />
    </section>,
  ));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function findButton(label) {
  return [...document.querySelectorAll("button")].find((button) => (
    label.test(button.getAttribute("aria-label") || button.textContent)
  ));
}

test("places a centered image preview outside transformed and clipped review content", async () => {
  await renderPreview();

  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.parentElement).toBe(document.body);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.textContent).toContain("Attachment Preview");
  expect(dialog.className).toEqual(expect.stringContaining("fixed"));
  expect(dialog.className).toEqual(expect.stringContaining("inset-0"));
  expect(dialog.className).toEqual(expect.stringContaining("items-center"));
  expect(dialog.className).toEqual(expect.stringContaining("justify-center"));
  expect(fetchBackendFileBlob).toHaveBeenCalledWith(
    expect.stringMatching(/\/uploads\/leave-attachments\/certificate\.png$/), "Medical certificate.png",
  );
  const image = dialog.querySelector("img");
  expect(image.src).toBe("blob:attachment-1");
  expect(image.alt).toBe("Medical certificate.png");
  expect(image.className).toEqual(expect.stringContaining("object-contain"));
  expect(image.className).toEqual(expect.stringContaining("max-w-full"));
  expect(image.className).toEqual(expect.stringContaining("max-h-"));
});

test("frames a fetched PDF instead of loading the application's attachment URL as a page", async () => {
  fetchBackendFileBlob.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
  await renderPreview({ attachmentName: "Medical certificate.pdf", attachmentPath: "uploads/medical.pdf" });

  const frame = document.querySelector("iframe");
  expect(frame).not.toBeNull();
  expect(frame.src).toEqual(expect.stringContaining("blob:attachment-1"));
  expect(frame.title).toBe("Medical certificate.pdf");
  expect(document.querySelector("img")).toBeNull();
});

test("shows a failed fetch and retries the same certificate without closing the preview", async () => {
  fetchBackendFileBlob.mockRejectedValueOnce(new Error("The file could not be retrieved from the server."));
  const onClose = jest.fn();
  await renderPreview({ onClose });

  expect(document.querySelector('[role="dialog"]').textContent).toContain("The file could not be retrieved from the server.");
  expect(document.querySelector("img")).toBeNull();
  const retry = findButton(/retry|try again/i);
  expect(retry).toBeDefined();
  await act(async () => retry.click());

  expect(fetchBackendFileBlob).toHaveBeenCalledTimes(2);
  expect(document.querySelector("img").src).toBe("blob:attachment-1");
  expect(onClose).not.toHaveBeenCalled();
});

test("keeps image clicks inside the preview and supports its close and backdrop controls", async () => {
  const onClose = jest.fn();
  await renderPreview({ onClose });

  act(() => document.querySelector("img").click());
  expect(onClose).not.toHaveBeenCalled();
  const close = document.querySelector('[role="dialog"] > div button[aria-label="Close attachment preview"]');
  expect(close).not.toBeNull();
  act(() => close.click());
  expect(onClose).toHaveBeenCalledTimes(1);
  const backdrop = document.querySelector('[role="dialog"] > button');
  expect(backdrop).not.toBeNull();
  expect(backdrop).not.toBe(close);
  act(() => backdrop.click());
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("Escape closes only the attachment above its review dialog", async () => {
  const onClose = jest.fn();
  const closeReview = jest.fn();
  await renderPreview({ onClose });
  window.addEventListener("keydown", closeReview);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

  try {
    act(() => document.body.dispatchEvent(escape));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
    expect(closeReview).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", closeReview);
  }
});

test("releases the previous object URL when switching attachments and on close", async () => {
  await renderPreview();
  await renderPreview({ attachmentPath: "uploads/second.png", attachmentName: "Second certificate.png" });

  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment-1");
  expect(document.querySelector("img").src).toBe("blob:attachment-2");
  await renderPreview({ open: false });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment-2");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("releases the object URL when its parent is unmounted", async () => {
  await renderPreview();
  act(() => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment-1");
});

test("ignores an earlier fetch that finishes after a different attachment has opened", async () => {
  const first = deferred();
  fetchBackendFileBlob.mockReturnValueOnce(first.promise);
  await renderPreview();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await renderPreview({ attachmentPath: "uploads/second.png", attachmentName: "Second certificate.png" });
  const currentSource = document.querySelector("img").src;

  await act(async () => first.resolve(new Blob(["late image"], { type: "image/png" })));
  expect(document.querySelector("img").src).toBe(currentSource);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

test("ignores a fetch that finishes after the preview has closed", async () => {
  const pending = deferred();
  fetchBackendFileBlob.mockReturnValueOnce(pending.promise);
  await renderPreview();
  await renderPreview({ open: false });
  await act(async () => pending.resolve(new Blob(["late image"], { type: "image/png" })));

  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("does not fetch while the preview is closed", async () => {
  await renderPreview({ open: false });
  expect(fetchBackendFileBlob).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("offers Cancel Upload only when the applicant supplies a removal action", async () => {
  await renderPreview();
  expect(findButton(/Cancel medical certificate upload/)).toBeUndefined();
  const onRemove = jest.fn();
  const onClose = jest.fn();
  await renderPreview({ onRemove, onClose });
  act(() => findButton(/Cancel medical certificate upload/).click());
  expect(onRemove).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await renderPreview({ onRemove, onClose, removing: true });
  const cancelButton = findButton(/Cancel medical certificate upload/);
  expect(cancelButton.disabled).toBe(true);
  expect(cancelButton.textContent).toContain("Cancelling...");
  act(() => cancelButton.click());
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test("explains a missing attachment without attempting to fetch it", async () => {
  await renderPreview({ attachmentPath: "", attachmentName: "certificate.png" });
  expect(document.querySelector('[role="alert"]').textContent).toContain("no attachment link available");
  expect(fetchBackendFileBlob).not.toHaveBeenCalled();
});

test("restores background scrolling and focus after closing the attachment", async () => {
  const previousOverflow = document.body.style.overflow;
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  document.body.style.overflow = "auto";

  try {
    await renderPreview();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement.closest('[role="dialog"]')).not.toBeNull();
    await renderPreview({ open: false });
    expect(document.body.style.overflow).toBe("auto");
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
    document.body.style.overflow = previousOverflow;
  }
});

test("reports an unreadable image and allows fetching it again", async () => {
  await renderPreview();
  act(() => document.querySelector("img").dispatchEvent(new Event("error")));
  expect(document.querySelector('[role="alert"]').textContent).toContain("could not be displayed");
  await act(async () => findButton(/retry/i).click());
  expect(fetchBackendFileBlob).toHaveBeenCalledTimes(2);
  expect(document.querySelector("img").src).toBe("blob:attachment-2");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment-1");
});

test.each([
  ["uploads/certificate.JPG?version=2", "", { image: true, pdf: false, canPreview: true }],
  ["uploads/opaque-file", "Medical certificate.PDF", { image: false, pdf: true, canPreview: true }],
  ["uploads/certificate.docx", "Medical certificate.docx", { image: false, pdf: false, canPreview: false }],
])("identifies the inline preview type for %s", (path, name, expected) => {
  expect(getLeaveAttachmentPreviewInfo(path, name)).toEqual(expect.objectContaining(expected));
});
