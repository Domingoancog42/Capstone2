import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProfileImageModal from "./ProfileImageModal";

// Use React DOM's installed test APIs; Testing Library is not installed in this checkout.
/* eslint-disable testing-library/no-unnecessary-act */
jest.mock("../UI/modal", () => function MockModal({ open, children, footer }) {
  return open ? <div role="dialog">{children}{footer}</div> : null;
});

const originalImage = window.Image;
const originalFileReader = window.FileReader;
let imageWidth;
let imageHeight;
let context;
let savedCanvas;
let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  imageWidth = 800;
  imageHeight = 800;
  context = { fillRect: jest.fn(), drawImage: jest.fn() };
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function () {
    savedCanvas = this;
    return "data:image/png;base64,cGFzc3BvcnQ=";
  });
  window.FileReader = jest.fn().mockImplementation(() => {
    const reader = { result: "data:image/png;base64,c291cmNl" };
    reader.readAsDataURL = () => reader.onload();
    return reader;
  });
  window.Image = jest.fn().mockImplementation(() => {
    const image = { width: imageWidth, height: imageHeight };
    Object.defineProperty(image, "src", {
      set() { image.onload(); },
    });
    return image;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.Image = originalImage;
  window.FileReader = originalFileReader;
  jest.restoreAllMocks();
});

function mount(props = {}) {
  act(() => root.render(<ProfileImageModal open onSave={jest.fn()} onClose={jest.fn()} {...props} />));
}

function click(name) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === name);
  act(() => button.click());
}

function uploadPhoto(file = new File(["photo"], "photo.png", { type: "image/png" })) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

test("previews a passport photo and saves a portrait crop with the PDS proportions", () => {
  const onSave = jest.fn();
  const onClose = jest.fn();
  mount({ onSave, onClose });

  expect(container.textContent).toContain("4.5 cm high × 3.5 cm wide");
  expect(container.textContent).toContain("unfiltered passport-sized photo taken within the last 6 months");
  uploadPhoto();
  expect(container.querySelector("img").style.objectPosition).toBe("50% 50%");
  click("Save Picture");

  expect(savedCanvas.width).toBe(420);
  expect(savedCanvas.height).toBe(540);
  expect(context.drawImage).toHaveBeenCalledWith(expect.any(Object), -60, 0, 540, 540);
  expect(onSave).toHaveBeenCalledWith("data:image/png;base64,cGFzc3BvcnQ=");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("saves the user's framing without stretching a landscape photo", () => {
  imageWidth = 1600;
  imageHeight = 900;
  mount();
  uploadPhoto();

  const input = [...container.querySelectorAll("label")].find((label) => label.textContent === "Horizontal position").querySelector("input");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "100");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("img").style.objectPosition).toBe("100% 50%");
  click("Save Picture");

  expect(context.drawImage).toHaveBeenCalledWith(expect.any(Object), -540, 0, 960, 540);
});

test("reports unreadable image data and lets the user choose another photo", () => {
  const onSave = jest.fn();
  const onClose = jest.fn();
  window.Image.mockImplementation(() => {
    const image = {};
    Object.defineProperty(image, "src", { set() { image.onerror(); } });
    return image;
  });
  mount({ onSave, onClose });
  uploadPhoto();
  click("Save Picture");

  expect(container.querySelector('[role="alert"]').textContent).toContain("Please choose another photo.");
  expect([...container.querySelectorAll("button")].find((node) => node.textContent === "Upload Image").disabled).toBe(false);
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("keeps an existing photo when saving without an upload and still supports removal", () => {
  const onSave = jest.fn();
  const onClose = jest.fn();
  mount({ currentImage: "data:image/png;base64,ZXhpc3Rpbmc=", onSave, onClose });

  click("Save Picture");
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);

  click("Remove");
  click("Save Picture");
  expect(onSave).toHaveBeenCalledWith("");
});

test("rejects non-image files before replacing the current preview", () => {
  mount();
  uploadPhoto(new File(["text"], "notes.txt", { type: "text/plain" }));

  expect(container.querySelector('[role="alert"]').textContent).toContain("Choose an image file");
  expect(container.textContent).toContain("Upload a passport photo");
});
