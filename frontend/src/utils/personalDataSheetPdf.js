// Render the filled official workbook so Excel and PDF use the same saved PDS data.
// Only the four form print areas are exported; the hidden lookup sheet is excluded.
const elements = (node, name) => Array.from(node?.getElementsByTagNameNS("*", name) || []);
const first = (node, name) => elements(node, name)[0];
const number = (node, attribute, fallback = 0) => Number(node?.getAttribute(attribute) ?? fallback);

function cellPosition(reference) {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(reference);
  if (!match) throw new Error("The PDS print area is invalid.");
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
}

function color(node, fallback = "000000", indexedColors = []) {
  const rgb = node?.getAttribute("rgb");
  const indexed = number(node, "indexed", -1);
  const theme = ["FFFFFF", "000000", "EEECE1", "1F497D", "4F81BD", "C0504D", "9BBB59", "8064A2", "4BACC6", "F79646", "0000FF", "800080"];
  const hex = rgb?.slice(-6) || theme[number(node, "theme", -1)] || indexedColors[indexed]
    || ({ 8: "000000", 9: "FFFFFF", 10: "FF0000", 22: "C0C0C0", 23: "808080", 55: "969696", 64: "000000" })[indexed] || fallback;
  const tint = number(node, "tint");
  return `#${[0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint).toString(16).padStart(2, "0");
  }).join("")}`;
}

function drawText(pdf, text, box, fontSize, alignment = {}, fontStyle = "normal", textColor = "#000000") {
  if (!text.trim() || box.width <= 0 || box.height <= 0) return;
  const padding = 1.5;
  pdf.setFont("helvetica", fontStyle);
  const availableWidth = Math.max(1, box.width - padding * 2);
  const availableHeight = Math.max(1, box.height - padding * 2);
  let size = fontSize;
  let lines;
  // Fit long saved values inside their original form fields without spilling into neighbours.
  for (let attempt = 0; attempt < 24; attempt++) {
    pdf.setFontSize(size);
    lines = pdf.splitTextToSize(text.replace(/\r/g, ""), availableWidth);
    if (lines.length * size * 1.05 <= availableHeight && lines.every((line) => pdf.getTextWidth(line) <= availableWidth + 0.1)) break;
    size *= 0.94;
  }
  const lineHeight = size * 1.05;
  const horizontal = ["center", "right"].includes(alignment.horizontal) ? alignment.horizontal : "left";
  const vertical = alignment.vertical || "bottom";
  const x = box.x + (horizontal === "center" ? box.width / 2 : horizontal === "right" ? box.width - padding : padding);
  const blockHeight = lines.length * lineHeight;
  const top = vertical === "center" ? box.y + (box.height - blockHeight) / 2
    : vertical === "top" ? box.y + padding : box.y + box.height - blockHeight - padding;
  pdf.setTextColor(textColor);
  lines.forEach((line, index) => pdf.text(line, x, top + size * 0.85 + index * lineHeight, { align: horizontal }));
}

export async function buildPersonalDataSheetPdf(workbook) {
  const [{ unzipSync, strFromU8 }, { jsPDF }] = await Promise.all([import("fflate"), import("jspdf")]);
  const parts = unzipSync(new Uint8Array(await workbook.arrayBuffer()));
  const parse = (path) => {
    if (!parts[path]) throw new Error("The PDS workbook is missing a required form page.");
    const document = new DOMParser().parseFromString(strFromU8(parts[path]), "application/xml");
    if (first(document, "parsererror")) throw new Error("The PDS workbook contains invalid form data.");
    return document;
  };
  const styles = parse("xl/styles.xml");
  // The official PDS overrides Excel's indexed palette (including both gray fills).
  const indexedColors = elements(first(styles, "indexedColors"), "rgbColor").map((node) => node.getAttribute("rgb")?.slice(-6));
  const workbookColor = (node, fallback) => color(node, fallback, indexedColors);
  const fonts = elements(first(styles, "fonts"), "font");
  const fills = elements(first(styles, "fills"), "fill");
  const borders = elements(first(styles, "borders"), "border");
  const formats = elements(first(styles, "cellXfs"), "xf");
  const strings = elements(parse("xl/sharedStrings.xml"), "si").map((node) => elements(node, "t").map((part) => part.textContent).join(""));
  const areas = elements(parse("xl/workbook.xml"), "definedName").filter((node) => node.getAttribute("name") === "_xlnm.Print_Area");
  const checked = new Set();
  for (const path of Object.keys(parts).filter((name) => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(name))) {
    for (const shape of elements(parse(path), "shape")) {
      if (first(shape, "Checked")?.textContent === "1") checked.add(String(shape.getAttribute("o:spid") || shape.getAttribute("id")).replace("_x0000_s", ""));
    }
  }
  const pdf = new jsPDF({ unit: "pt", format: "legal", orientation: "portrait", compress: true });
  pdf.setProperties({ title: "Personal Data Sheet - CS Form No. 212 (Revised 2025)" });
  for (let page = 0; page < 4; page++) {
    if (page) pdf.addPage("legal", "portrait");
    const sheet = parse(`xl/worksheets/sheet${page + 1}.xml`);
    const area = areas.find((node) => number(node, "localSheetId") === page)?.textContent.split("!").pop();
    if (!area) throw new Error("The PDS workbook is missing its print area.");
    const [start, end] = area.split(":").map(cellPosition);
    const format = first(sheet, "sheetFormatPr");
    const widths = Array(end.column + 2).fill(number(format, "defaultColWidth", 9.27) * 7 * 0.75 + 3.75);
    for (const column of elements(first(sheet, "cols"), "col")) {
      for (let i = number(column, "min") - 1; i < Math.min(number(column, "max"), widths.length); i++) {
        widths[i] = number(column, "hidden") ? 0 : (number(column, "width", 9.27) * 7 + 5) * 0.75;
      }
    }
    const rows = elements(first(sheet, "sheetData"), "row");
    const heights = Array(end.row + 2).fill(number(format, "defaultRowHeight", 12.5));
    rows.forEach((row) => { const i = number(row, "r") - 1; if (i < heights.length) heights[i] = number(row, "hidden") ? 0 : number(row, "ht", number(format, "defaultRowHeight", 12.5)); });
    const offsets = (values) => values.reduce((result, value) => [...result, result[result.length - 1] + value], [0]);
    const xs = offsets(widths);
    const ys = offsets(heights);
    const margin = 12;
    const scale = Math.min((612 - margin * 2) / (xs[end.column + 1] - xs[start.column]), (1008 - margin * 2) / (ys[end.row + 1] - ys[start.row]));
    const x = (position) => margin + (position - xs[start.column]) * scale;
    const y = (position) => margin + (position - ys[start.row]) * scale;
    const merges = elements(sheet, "mergeCell").map((node) => node.getAttribute("ref").split(":").map(cellPosition));
    const cells = [];
    for (const row of rows) {
      for (const cell of elements(row, "c")) {
        const position = cellPosition(cell.getAttribute("r"));
        if (position.column < start.column || position.column > end.column || position.row < start.row || position.row > end.row) continue;
        const merge = merges.find(([from, to]) => position.column >= from.column && position.column <= to.column && position.row >= from.row && position.row <= to.row);
        const style = formats[number(cell, "s")];
        const box = { x: x(xs[position.column]), y: y(ys[position.row]), width: widths[position.column] * scale, height: heights[position.row] * scale };
        const fill = first(fills[number(style, "fillId")], "patternFill");
        if (fill?.getAttribute("patternType") === "solid" && (!merge || (position.column === merge[0].column && position.row === merge[0].row))) {
          pdf.setFillColor(workbookColor(first(fill, "fgColor"), "FFFFFF"));
          const width = merge ? (xs[Math.min(merge[1].column, end.column) + 1] - xs[position.column]) * scale : box.width;
          const height = merge ? (ys[Math.min(merge[1].row, end.row) + 1] - ys[position.row]) * scale : box.height;
          pdf.rect(box.x, box.y, width, height, "F");
        }
        cells.push({ cell, position, merge, style, box });
      }
    }
    // Paint backgrounds first, then borders and labels, including the edges of merged cells.
    for (const { style, box, merge, position } of cells) {
      const border = borders[number(style, "borderId")];
      for (const side of ["left", "right", "top", "bottom"]) {
        if (merge && ((side === "left" && position.column !== merge[0].column)
          || (side === "right" && position.column !== merge[1].column)
          || (side === "top" && position.row !== merge[0].row)
          || (side === "bottom" && position.row !== merge[1].row))) continue;
        const edge = first(border, side);
        if (!edge?.getAttribute("style")) continue;
        pdf.setDrawColor(workbookColor(first(edge, "color")));
        pdf.setLineWidth((edge.getAttribute("style") === "medium" ? 0.9 : 0.4) * scale);
        if (side === "left" || side === "right") {
          const at = box.x + (side === "right" ? box.width : 0);
          pdf.line(at, box.y, at, box.y + box.height);
        } else {
          const at = box.y + (side === "bottom" ? box.height : 0);
          pdf.line(box.x, at, box.x + box.width, at);
        }
      }
    }
    for (const { cell, position, merge, style, box: originalBox } of cells) {
      if (merge && (position.column !== merge[0].column || position.row !== merge[0].row)) continue;
      const box = merge ? { ...originalBox, width: (xs[Math.min(merge[1].column, end.column) + 1] - xs[position.column]) * scale, height: (ys[Math.min(merge[1].row, end.row) + 1] - ys[position.row]) * scale } : originalBox;
      const value = first(cell, "v")?.textContent || "";
      const text = cell.getAttribute("t") === "s" ? strings[Number(value)] || ""
        : cell.getAttribute("t") === "inlineStr" ? elements(cell, "t").map((node) => node.textContent).join("") : value;
      const font = fonts[number(style, "fontId")];
      const bold = Boolean(first(font, "b"));
      const italic = Boolean(first(font, "i"));
      const alignment = first(style, "alignment");
      if (!merge && alignment?.getAttribute("wrapText") !== "1" && text) {
        let nextColumn = position.column + 1;
        while (nextColumn <= end.column) {
          const candidateColumn = nextColumn;
          const next = cells.find((item) => item.position.row === position.row && item.position.column === candidateColumn);
          if (next?.merge || first(next?.cell, "v")?.textContent || first(next?.cell, "is")) break;
          nextColumn++;
        }
        box.width = (xs[nextColumn] - xs[position.column]) * scale;
      }
      drawText(pdf, text, box, number(first(font, "sz"), "val", 8) * scale,
        { horizontal: alignment?.getAttribute("horizontal"), vertical: alignment?.getAttribute("vertical") },
        bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal", workbookColor(first(font, "color")));
    }
    // The official form keeps checkbox captions and the photo box in drawing anchors.
    const relationPath = `xl/worksheets/_rels/sheet${page + 1}.xml.rels`;
    if (parts[relationPath]) {
      const relation = elements(parse(relationPath), "Relationship").find((node) => node.getAttribute("Type")?.endsWith("/drawing"));
      if (relation) {
        const drawingPath = `xl/${relation.getAttribute("Target").replace(/^\.\.\//, "")}`;
        for (const anchor of elements(parse(drawingPath), "twoCellAnchor")) {
          const from = first(anchor, "from");
          const to = first(anchor, "to");
          const col = Number(first(from, "col")?.textContent);
          const row = Number(first(from, "row")?.textContent);
          const lastCol = Number(first(to, "col")?.textContent);
          const lastRow = Number(first(to, "row")?.textContent);
          if (col < start.column || col > end.column || row < start.row || row > end.row || lastCol >= xs.length || lastRow >= ys.length) continue;
          const emu = (node, name) => Number(first(node, name)?.textContent || 0) / 12700;
          const left = xs[col] + emu(from, "colOff");
          const top = ys[row] + emu(from, "rowOff");
          const box = { x: x(left), y: y(top), width: (xs[lastCol] + emu(to, "colOff") - left) * scale, height: (ys[lastRow] + emu(to, "rowOff") - top) * scale };
          const text = elements(anchor, "p").map((paragraph) => elements(paragraph, "t").map((node) => node.textContent).join("")).join("\n").trim();
          const metadata = first(anchor, "cNvPr");
          if (metadata?.getAttribute("name")?.startsWith("Check Box")) {
            const size = 7 * scale;
            const cy = box.y + (box.height - size) / 2;
            pdf.setDrawColor("#000000");
            pdf.setLineWidth(0.5);
            pdf.rect(box.x, cy, size, size);
            if (checked.has(metadata.getAttribute("id"))) {
              pdf.line(box.x + 1, cy + size / 2, box.x + size / 2, cy + size - 1);
              pdf.line(box.x + size / 2, cy + size - 1, box.x + size - 1, cy + 1);
            }
            drawText(pdf, text, { ...box, x: box.x + size + 1, width: Math.max(box.width - size - 1, 20 * scale) }, 8 * scale, { vertical: "center" });
          } else if (text) {
            if (page === 0 && /^CS\s*Form No\.\s*212/.test(text)) {
              drawText(pdf, "CS Form No. 212\nRevised 2025",
                { x: margin + 1, y: margin + 1, width: 160 * scale, height: 24 * scale },
                8 * scale, { horizontal: "left", vertical: "top" }, "bolditalic");
              continue;
            }
            if (/Passport-sized/.test(text)) {
              pdf.setDrawColor("#000000");
              pdf.setLineWidth(0.5);
              pdf.rect(box.x, box.y, box.width, box.height);
            }
            const run = first(anchor, "rPr") || first(anchor, "defRPr");
            drawText(pdf, text, box, number(run, "sz", 800) / 100 * scale, { horizontal: "center", vertical: "center" });
          }
        }
      }
    }
  }
  return pdf;
}
