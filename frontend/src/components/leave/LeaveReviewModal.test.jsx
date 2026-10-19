import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LeaveReviewModal from "./LeaveReviewModal";

/* eslint-disable testing-library/no-unnecessary-act */
let container;
let root;
const originalFetch = global.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const request = {
  id: 42,
  employeeName: "Test Employee",
  leaveType: "Sick Leave",
  status: "Pending",
  dateFiled: "2026-10-19",
  startDate: "2026-10-20",
  endDate: "2026-10-20",
  numberOfDays: 1,
  attachmentName: "medical-certificate.jpg",
  attachmentPath: "uploads/leave-attachments/medical-certificate.jpg",
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["certificate"], { type: "image/jpeg" }),
  });
  URL.createObjectURL = jest.fn(() => "blob:medical-certificate");
  URL.revokeObjectURL = jest.fn();
  container = document.createElement("div");
  container.style.transform = "translateY(8px)";
  container.style.overflow = "hidden";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

function mountReview(nextRequest = request, onClose = jest.fn()) {
  act(() => root.render(<LeaveReviewModal open request={nextRequest} onClose={onClose} />));
  return onClose;
}

function getReviewDialog() {
  return Array.from(document.body.querySelectorAll("h2"))
    .find((heading) => heading.textContent === "Review Leave Request")
    ?.closest('[role="dialog"]');
}

function getAttachmentDialog() {
  return document.body.querySelector('[aria-label="Close attachment preview"]')
    ?.closest('[role="dialog"]');
}

async function openAttachment() {
  const button = Array.from(getReviewDialog().querySelectorAll("button"))
    .find((candidate) => candidate.textContent.includes("View Attach"));
  await act(async () => button.click());
  return getAttachmentDialog();
}

test("opens the attached photo above the review outside transformed and clipped ancestors", async () => {
  const onClose = mountReview();
  const review = getReviewDialog();
  expect(review.parentElement).toBe(document.body);
  expect(container.contains(review)).toBe(false);

  const preview = await openAttachment();
  expect(preview.parentElement).toBe(document.body);
  expect(review.contains(preview)).toBe(false);
  expect(preview.querySelector("img")).not.toBeNull();

  act(() => preview.querySelector("img").click());
  expect(getAttachmentDialog()).toBe(preview);
  expect(onClose).not.toHaveBeenCalled();

  act(() => preview.querySelector('[aria-label="Close attachment preview"]').click());
  expect(getAttachmentDialog()).toBeUndefined();
  expect(getReviewDialog()).toBe(review);
  expect(onClose).not.toHaveBeenCalled();
});

test("Escape dismisses only the attachment and lets the reviewer reopen it", async () => {
  const onClose = mountReview();
  await openAttachment();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  expect(getAttachmentDialog()).toBeUndefined();
  expect(getReviewDialog()).toBeDefined();
  expect(onClose).not.toHaveBeenCalled();

  await openAttachment();
  expect(getAttachmentDialog()).toBeDefined();
});

test("keeps legacy filename-only attachments readable without inventing a preview URL", () => {
  mountReview({ ...request, attachmentPath: "" });
  const review = getReviewDialog();

  expect(review.textContent).toContain("medical-certificate.jpg");
  expect(review.textContent).toContain("no preview link available yet");
  expect(Array.from(review.querySelectorAll("button")).some((button) => button.textContent.includes("View Attach"))).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("allows review of an attachment whose path was saved without a display name", async () => {
  mountReview({ ...request, attachmentName: "" });
  expect(getReviewDialog().textContent).toContain("medical-certificate.jpg");
  expect(await openAttachment()).toBeDefined();
});
