import { uploadEmployeeDocument } from "./api";
import { saveEmployeeDocumentFiles } from "./employeeDocumentUploads";

jest.mock("./api", () => ({ uploadEmployeeDocument: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

test("uploads each document to the newly saved employee and retries only failed files", async () => {
  const certificate = { documentType: "birth_certificate", file: new File(["birth"], "birth.pdf") };
  const diploma = { documentType: "diploma", file: new File(["diploma"], "diploma.pdf") };
  uploadEmployeeDocument.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error("offline"));
  const failed = await saveEmployeeDocumentFiles(42, [certificate, diploma]);
  expect(uploadEmployeeDocument).toHaveBeenNthCalledWith(1, 42, "birth_certificate", certificate.file);
  expect(uploadEmployeeDocument).toHaveBeenNthCalledWith(2, 42, "diploma", diploma.file);
  expect(failed).toEqual([diploma]);
  uploadEmployeeDocument.mockResolvedValueOnce({ success: true });
  expect(await saveEmployeeDocumentFiles(42, failed)).toEqual([]);
  expect(uploadEmployeeDocument).toHaveBeenCalledTimes(3);
  expect(uploadEmployeeDocument).toHaveBeenLastCalledWith(42, "diploma", diploma.file);
});

test("retains files without uploading to a missing employee record", async () => {
  const attachments = [{ documentType: "valid_id", file: new File(["id"], "id.pdf") }];
  expect(await saveEmployeeDocumentFiles(0, attachments)).toEqual(attachments);
  expect(uploadEmployeeDocument).not.toHaveBeenCalled();
});
