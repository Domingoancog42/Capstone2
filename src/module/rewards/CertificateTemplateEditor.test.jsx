import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CertificateTemplateEditor from "./CertificateTemplateEditor";
import { createCertificateTemplate } from "./certificateTemplate";
import {
  assignCertificateTemplateToCycle,
  fetchAwardCycles,
  fetchCertificateTemplate,
  uploadCertificateDesign,
  uploadCertificateSignature,
} from "../../services/api";

jest.mock("html2canvas", () => jest.fn());
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));
jest.mock("react-hot-toast", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-signature-canvas", () => {
  const ReactModule = require("react");

  return ReactModule.forwardRef(({ canvasProps }, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      clear: jest.fn(),
      isEmpty: () => false,
      getCanvas: () => ({
        toBlob: (callback) => callback(new Blob(["signature"], { type: "image/png" })),
      }),
    }));

    return <canvas aria-label={canvasProps?.["aria-label"]} />;
  });
});
jest.mock("../../services/api", () => ({
  assignCertificateTemplateToCycle: jest.fn(),
  fetchAwardCycles: jest.fn(),
  fetchCertificateTemplate: jest.fn(),
  updateCertificateTemplate: jest.fn(),
  uploadCertificateDesign: jest.fn(),
  uploadCertificateSignature: jest.fn(),
}));

describe("CertificateTemplateEditor selection", () => {
  beforeEach(() => {
    fetchCertificateTemplate.mockResolvedValue({ template: createCertificateTemplate("classic") });
    fetchAwardCycles.mockResolvedValue({ cycles: [] });
  });

  test("shows a selection outline only after an element is clicked and clears it when a design is chosen", async () => {
    render(<CertificateTemplateEditor />);

    await waitFor(() => expect(screen.getByText("Select an element")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Template 1: Classic Gold" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Template 10: Golden Sunrise" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Edit Signatory name" }).style.borderBottom).not.toBe("");
    expect(screen.getByRole("button", { name: "Edit Signatory name" }).style.borderTop).toBe("");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Edit Certificate title" }));
    fireEvent.pointerUp(window);
    expect(screen.getByText("Selected block")).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "Font" }).options).toHaveLength(17);

    fireEvent.click(screen.getByRole("button", { name: /Modern Teal/i }));
    expect(screen.getByText("Select an element")).not.toBeNull();
    expect(screen.queryByText("Selected block")).toBeNull();
  });

  test("uploads and previews a certificate signature", async () => {
    uploadCertificateSignature.mockResolvedValue({
      signatureImage: "uploads/certificate-signatures/signature_test.png",
    });
    render(<CertificateTemplateEditor />);
    await waitFor(() => expect(screen.getByText("Select an element")).not.toBeNull());

    const file = new File(["signature"], "signature.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload certificate signature"), { target: { files: [file] } });

    await waitFor(() => expect(uploadCertificateSignature).toHaveBeenCalledWith(file));
    expect(await screen.findByAltText("Certificate signature preview")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Template 2: Modern Teal" }));
    expect(screen.queryByAltText("Certificate signature preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Template 1: Classic Gold" }));
    expect(screen.getByAltText("Certificate signature preview")).not.toBeNull();
  });

  test("draws and saves an optional e-signature", async () => {
    uploadCertificateSignature.mockResolvedValue({
      signatureImage: "uploads/certificate-signatures/e_signature_test.png",
    });
    render(<CertificateTemplateEditor />);
    await waitFor(() => expect(screen.getByText("Select an element")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Draw e-signature" }));
    expect(screen.getByRole("dialog", { name: "Draw e-signature" })).not.toBeNull();
    expect(screen.getByLabelText("E-signature drawing pad")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use signature" }));

    await waitFor(() => expect(uploadCertificateSignature).toHaveBeenCalledWith(expect.any(File)));
    const drawnFile = uploadCertificateSignature.mock.calls.at(-1)[0];
    expect(drawnFile.type).toBe("image/png");
    expect(await screen.findByAltText("Certificate signature preview")).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "Draw e-signature" })).toBeNull();
  });

  test("uploads a custom design image only for the active certificate template", async () => {
    uploadCertificateDesign.mockResolvedValue({
      backgroundImage: "uploads/certificate-designs/design_test.jpg",
    });
    render(<CertificateTemplateEditor />);
    await waitFor(() => expect(screen.getByText("Select an element")).not.toBeNull());

    const file = new File(["design"], "design.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Upload certificate design image"), { target: { files: [file] } });

    await waitFor(() => expect(uploadCertificateDesign).toHaveBeenCalledWith(file));
    expect(await screen.findByAltText("Uploaded certificate design preview")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Template 2: Modern Teal" }));
    expect(screen.queryByAltText("Uploaded certificate design preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Template 1: Classic Gold" }));
    expect(screen.getByAltText("Uploaded certificate design preview")).not.toBeNull();
  });

  test("assigns the current certificate design to an open nomination", async () => {
    fetchAwardCycles.mockResolvedValue({
      cycles: [{ id: "42", category: "Best Employee of the Year", status: "ongoing", isArchived: false }],
    });
    assignCertificateTemplateToCycle.mockResolvedValue({ message: "Certificate assigned." });
    render(<CertificateTemplateEditor />);
    await waitFor(() => expect(screen.getByText("Select an element")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Use this certificate for nomination" }));
    expect(await screen.findByRole("option", { name: "Best Employee of the Year" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use for nomination" }));

    await waitFor(() => expect(assignCertificateTemplateToCycle).toHaveBeenCalledWith(expect.objectContaining({
      cycleId: "42",
      template: expect.objectContaining({ preset: "classic" }),
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Use certificate for nomination" })).toBeNull());
  });
});
