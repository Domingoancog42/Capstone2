import fs from "fs";
import path from "path";
import { inflateSync } from "zlib";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { buildPersonalDataSheetPdf } from "./personalDataSheetPdf";

const templatePath = path.resolve(__dirname, "../../backend/templates/Personal-Data-Sheet-CS-Form-No.-212-Revised-2026.xlsx");
const workbookBlob = (bytes) => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer });

function textStreams(pdf) {
  const bytes = Buffer.from(pdf.output("arraybuffer"));
  const text = bytes.toString("latin1");
  const chunks = [];
  const pattern = /stream\r?\n/g;
  while (pattern.exec(text)) {
    const start = pattern.lastIndex;
    const end = text.indexOf("\nendstream", start);
    if (end < 0) break;
    chunks.push(inflateSync(bytes.subarray(start, end)).toString("latin1"));
    pattern.lastIndex = end + 10;
  }
  return chunks.join("\n");
}

test("2026 PDF exports the four main pages and suppresses checkbox/dropdown backing values", async () => {
  const pdf = await buildPersonalDataSheetPdf(workbookBlob(fs.readFileSync(templatePath)));
  expect(pdf.getNumberOfPages()).toBe(4);
  expect(Buffer.from(pdf.output("arraybuffer")).toString("latin1")).toMatch(/\/Title .*Revised 2026/);
  const text = textStreams(pdf);
  expect(text).toContain("Revised 2026");
  expect(text).not.toContain("Revised 2025");
  expect(text).not.toMatch(/\(4\)\s*Tj/);
  expect(text.includes("(MONTHLY)") && text.includes("(SALARY)")).toBe(true);
});

test("a populated work continuation is included without blank continuation pages", async () => {
  const parts = unzipSync(Uint8Array.from(fs.readFileSync(templatePath)));
  parts["xl/worksheets/sheet6.xml"] = strToU8(strFromU8(parts["xl/worksheets/sheet6.xml"])
    .replace(/<c\b([^>]*\br="D7"[^>]*?)(?:\/>|>.*?<\/c>)/s,
      '<c $1 t="inlineStr"><is><t>Overflow Appointment</t></is></c>'));
  const pdf = await buildPersonalDataSheetPdf(workbookBlob(zipSync(parts)));
  expect(pdf.getNumberOfPages()).toBe(5);
  expect(textStreams(pdf)).toContain("Overflow Appointment");
});

function workbookWithPictures() {
  const parts = unzipSync(Uint8Array.from(fs.readFileSync(templatePath)));
  const drawingPath = "xl/drawings/drawing2.xml";
  const drawing = new DOMParser().parseFromString(strFromU8(parts[drawingPath]), "application/xml");
  const photoFrame = [...drawing.getElementsByTagNameNS("*", "twoCellAnchor")]
    .find((anchor) => anchor.textContent.includes("Passport-sized"));
  const picture = (name, id, relationship) => {
    const anchor = photoFrame.cloneNode(true);
    const shape = anchor.getElementsByTagNameNS("*", "sp")[0];
    const document = new DOMParser().parseFromString(
      `<xdr:pic xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${name}"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationship}"/></xdr:blipFill></xdr:pic>`, "application/xml");
    anchor.replaceChild(drawing.importNode(document.documentElement, true), shape);
    drawing.documentElement.appendChild(anchor);
  };
  picture("PDS Passport Photo", 5000, "rIdPhoto");
  picture("PDS E-Signature", 5001, "rIdSignature");
  parts[drawingPath] = strToU8(new XMLSerializer().serializeToString(drawing));
  parts["xl/drawings/_rels/drawing2.xml.rels"] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/profile.png"/><Relationship Id="rIdSignature" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/signature.png"/></Relationships>');
  const image = Uint8Array.from(fs.readFileSync(path.resolve(__dirname, "../../public/logo192.png")));
  parts["xl/media/profile.png"] = image;
  parts["xl/media/signature.png"] = image;
  return parts;
}

test("saved passport photo and e-signature are embedded on page four and replace the photo instructions", async () => {
  const pdf = await buildPersonalDataSheetPdf(workbookBlob(zipSync(workbookWithPictures())));
  expect(pdf.getNumberOfPages()).toBe(4);
  for (const page of [1, 2, 3]) expect(pdf.internal.pages[page].join("\n")).not.toMatch(/\/I\d+ Do/);
  const fourthPage = pdf.internal.pages[4].join("\n");
  expect(fourthPage.match(/\/I\d+ Do/g)).toHaveLength(2);
  expect(fourthPage).not.toContain("Passport-sized");
  expect(fourthPage).toContain("Signature");
});

test("a workbook with missing saved image data fails instead of silently exporting an unsigned PDS", async () => {
  const parts = workbookWithPictures();
  delete parts["xl/media/signature.png"];
  await expect(buildPersonalDataSheetPdf(workbookBlob(zipSync(parts))))
    .rejects.toThrow("A saved PDS photo or signature could not be loaded.");
});

// Optional end-to-end fixtures generated by the PHP regression check, for visual QA.
const fixtureDirectory = process.env.PDS_PDF_VERIFICATION_DIR;
(fixtureDirectory ? test : test.skip)("renders filled PHP exports with salary and all 28 work records", async () => {
  for (const [name, pages] of [["main", 4], ["continuation", 5]]) {
    const pdf = await buildPersonalDataSheetPdf(workbookBlob(fs.readFileSync(path.join(fixtureDirectory, `pds-2026-${name}.xlsx`))));
    expect(pdf.getNumberOfPages()).toBe(pages);
    const text = textStreams(pdf);
    expect(text).toContain("Test Last");
    expect(text).toContain("21,877.25");
    expect(text).toContain("11-2");
    for (const suffix of ["III", "Jr.", "Sr."]) expect(text.includes(`(${suffix})`)).toBe(true);
    expect(text).not.toContain("Don't Know");
    if (name === "continuation") expect(text).toContain("Work Record 28");
    fs.writeFileSync(path.join(fixtureDirectory, `pds-2026-${name}.pdf`), Buffer.from(pdf.output("arraybuffer")));
  }
});

(fixtureDirectory ? test : test.skip)("saved eligibility and training fill main and continuation PDF pages", async () => {
  const pdf = await buildPersonalDataSheetPdf(workbookBlob(fs.readFileSync(path.join(fixtureDirectory, "pds-2026-sections.xlsx"))));
  expect(pdf.getNumberOfPages()).toBe(6);
  const text = textStreams(pdf);
  for (const value of ["Civil Eligibility 1", "Civil Eligibility 7", "Civil Eligibility 8", "Civil Eligibility 31",
    "Training Program 1", "Training Program 8", "Training Program 17", "Training Program 18", "Training Program 61",
    "00031", "11/08/2024", "Test Learning Academy"]) expect(text).toContain(value);
  fs.writeFileSync(path.join(fixtureDirectory, "pds-2026-sections.pdf"), Buffer.from(pdf.output("arraybuffer")));
});

(fixtureDirectory ? test : test.skip)("saved PHP photo and signature render in their PDS boxes", async () => {
  const pdf = await buildPersonalDataSheetPdf(workbookBlob(fs.readFileSync(path.join(fixtureDirectory, "pds-2026-media.xlsx"))));
  const page = pdf.internal.pages[4].join("\n");
  expect(page.match(/\/I\d+ Do/g)).toHaveLength(2);
  expect(page.includes("Passport-sized")).toBe(false);
  // Only the notary's separate digital-certificate placeholder remains.
  expect(page.match(/digital certificate/g)).toHaveLength(1);
  expect(page.includes("(GSIS)")).toBe(true);
  fs.writeFileSync(path.join(fixtureDirectory, "pds-2026-media.pdf"), Buffer.from(pdf.output("arraybuffer")));
});
