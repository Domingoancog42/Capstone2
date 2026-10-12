import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Modal from "./modal";

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
  document.documentElement.classList.remove("dark");
});

test.each(["light", "dark"])("notification dialog escapes the header in %s mode and keeps its theme scope", async (theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const onClose = jest.fn();
  await act(async () => root.render(
    <header className="app-topbar-themed" style={{ backdropFilter: "blur(16px)" }}>
      <Modal open portal containerClassName="notification-bell" title="Medical Certificate Reminder" onClose={onClose}>
        Upload your medical certificate.
      </Modal>
    </header>
  ));
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.parentElement).toBe(document.body);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(dialog.classList.contains("notification-bell")).toBe(true);
  expect(dialog.textContent).toContain("Medical Certificate Reminder");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("keeps existing inline dialogs in their original scope", async () => {
  await act(async () => root.render(<Modal open title="Existing dialog">Contents</Modal>));
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});
