import { serviceRecordPdfBoxes, serviceRecordRowsFromPdfPages } from "./serviceRecordPdfImport";

export async function readServiceRecordPdf(file) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, stopAtErrors: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 50) throw new Error("Import a PDF with no more than 50 pages.");
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((item) => typeof item.str === "string").map((item) => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        return { str: item.str, x: transform[4], y: transform[5], width: item.width };
      });
      pages.push({ items, boxes: serviceRecordPdfBoxes(pdfjs, viewport, await page.getOperatorList()) });
      page.cleanup();
    }
    return serviceRecordRowsFromPdfPages(pages);
  } catch (error) {
    if (error.name === "PasswordException") throw new Error("This PDF is password-protected. Upload an unlocked copy.");
    if (error.name === "InvalidPDFException") throw new Error("This file is not a readable PDF. Choose a valid service record PDF.");
    throw error;
  } finally {
    await task.destroy();
  }
}
