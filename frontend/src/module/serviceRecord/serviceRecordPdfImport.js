const key = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
// Two-digit years too: the printed form writes its dates MM-DD-YY.
const datePattern = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2})|\d{1,2}-[A-Za-z]{3}-\d{4})$/;
const fields = [
  ["From", ["from", "servicefrom"]], ["To", ["to", "serviceto"]],
  ["Designation/Step", ["designation", "designationstep", "position"]],
  ["Status", ["status", "employmentstatus"]], ["Salary", ["salary", "monthlysalary"]],
  ["Station/Place", ["station", "stationplace", "officeentity"]], ["Branch", ["branch"]],
  ["LV. / AB. w/o Pay", ["lvab", "lvabwopay", "lwop", "leavewithoutpay", "leaveof", "leaveofabsence", "leaveofabsencewopay"]],
  ["Separation Date", ["separation", "separationdate"]], ["Cause", ["cause", "separationcause"]], ["Remarks", ["remarks"]],
];

/** Table cell outlines give reliable column edges even when a cell contains one short character. */
export function serviceRecordPdfBoxes(pdfjs, viewport, operators) {
  const boxes = [];
  const stack = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  for (let index = 0; index < operators.fnArray.length; index++) {
    const operation = operators.fnArray[index];
    const args = operators.argsArray[index];
    if (operation === pdfjs.OPS.save) stack.push([...matrix]);
    else if (operation === pdfjs.OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (operation === pdfjs.OPS.transform) matrix = pdfjs.Util.transform(matrix, args);
    else if (operation === pdfjs.OPS.constructPath && args[2]?.length === 4) {
      const [x1, y1, x2, y2] = args[2];
      const transform = pdfjs.Util.transform(viewport.transform, matrix);
      const points = [[x1, y1], [x1, y2], [x2, y1], [x2, y2]].map(([x, y]) => [
        transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5],
      ]);
      boxes.push({ left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x)), top: Math.min(...points.map(([, y]) => y)), bottom: Math.max(...points.map(([, y]) => y)) });
    }
  }
  return boxes;
}

/** Use the printed column positions to retain blank cells and wrapped text. */
export function serviceRecordRowsFromPdfPages(pages) {
  const result = [fields.map(([name]) => name)];
  for (const [pageIndex, page] of pages.entries()) {
    const items = (page.items || page).filter((item) => item.str?.trim()).map((item) => ({ ...item, str: item.str.trim() }));
    if (!items.length) throw new Error(`Page ${pageIndex + 1} has no readable text. Scanned PDFs need OCR before import; choose a searchable PDF or Excel form.`);
    const from = items.find((item) => key(item.str) === "from");
    if (!from) {
      // A final page may contain only the certification block.
      if (result.length > 1 && items.some((item) => /issued in compliance|certified correct/i.test(item.str))) continue;
      throw new Error(`Page ${pageIndex + 1}: service record table headings were not found. Use a PDF with a readable service record table.`);
    }
    const headerItems = items.filter((item) => Math.abs(item.y - from.y) < 40);
    const anchors = fields.map(([name, aliases], index) => {
      const match = headerItems.find((item) => aliases.includes(key(item.str)));
      return match ? { index, x: match.x + match.width / 2, y: match.y, name } : null;
    });
    // Grouped forms label separation with Date and Cause on the bottom heading row.
    {
      const match = headerItems.find((item) => key(item.str) === "date" && item.x > (anchors[6]?.x || anchors[5]?.x || 0));
      if (match) anchors[8] = { index: 8, x: match.x + match.width / 2, y: match.y };
    }
    /*
     * The printed form (and the PDF drawn to match it) stacks Separation, Date/Cause and Remarks in one
     * column, and states salary per annum. The headings tell the server to split the one and convert the other.
     */
    if (anchors[8] && anchors[10] && Math.abs(anchors[8].x - anchors[10].x) < 15) {
      anchors[8] = null;
      result[0][10] = "Separation Date/Cause Remarks";
    }
    if (anchors[4] && headerItems.some((item) => key(item.str) === "annum" && Math.abs(item.x + item.width / 2 - anchors[4].x) < 30)) {
      result[0][4] = "Salary/Annum";
    }
    if ([0, 1, 2, 3, 4, 5].some((index) => !anchors[index])) {
      throw new Error(`Page ${pageIndex + 1}: could not identify From, To, Designation, Status, Salary, and Station columns. Use an Excel form if the PDF layout differs.`);
    }
    const sorted = anchors.filter(Boolean).sort((a, b) => a.x - b.x);
    for (const anchor of sorted) {
      const edges = (page.boxes || []).filter((box) => box.top <= anchor.y && box.bottom >= anchor.y).flatMap((box) => [box.left, box.right]);
      const left = Math.max(...edges.filter((edge) => edge < anchor.x - 1));
      const right = Math.min(...edges.filter((edge) => edge > anchor.x + 1));
      if (Number.isFinite(left) && Number.isFinite(right) && right - left < 150) anchor.bounds = { left, right };
    }
    const columnFor = (item) => {
      const center = item.x + item.width / 2;
      const containing = sorted.find((anchor) => anchor.bounds && center >= anchor.bounds.left && center <= anchor.bounds.right);
      if (containing) return containing.index;
      return sorted.reduce((best, candidate) => Math.abs(candidate.x - center) < Math.abs(best.x - center) ? candidate : best).index;
    };
    const lines = [];
    for (const item of items.sort((a, b) => a.y - b.y || a.x - b.x)) {
      let line = lines.find((candidate) => Math.abs(candidate.y - item.y) < 2);
      if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
      line.items.push(item);
    }
    let current = null;
    for (const line of lines) {
      if (line.y <= Math.max(anchors[0].y, anchors[1].y) + 3) continue;
      const lineText = line.items.map((item) => item.str).join(" ");
      if (/issued in compliance|certified correct|nothing follows|end of record|^CS Form No\. 1\s*\||^Page \d+ of \d+$/i.test(lineText)) break;
      const cells = fields.map(() => "");
      for (const item of line.items.sort((a, b) => a.x - b.x)) {
        const column = columnFor(item);
        cells[column] = `${cells[column]} ${item.str}`.trim();
      }
      if (datePattern.test(cells[0])) {
        if (current) result.push(current);
        current = cells;
      } else if (current) {
        if (cells[0]) throw new Error(`Page ${pageIndex + 1}: could not read a service start date (${cells[0]}). No records were imported.`);
        for (const [index, value] of cells.entries()) {
          if (value) current[index] = `${current[index]} ${value}`.trim();
        }
      } else if (cells[0] && /\d/.test(cells[0])) {
        throw new Error(`Page ${pageIndex + 1}: invalid service start date (${cells[0]}).`);
      } else if (cells[2] && cells[3] && cells[5]) {
        throw new Error(`Page ${pageIndex + 1}: a service entry is missing its start date.`);
      }
    }
    if (current) result.push(current);
    if (result.length > 501) throw new Error("Import up to 500 service entries at a time.");
  }
  if (result.length === 1) throw new Error("No readable service record entries were found in this PDF.");
  return result;
}
