/*
 * The printable box shared by A4 (210 × 297 mm) and short bond paper (8.5 × 11 in, 215.9 × 279.4 mm)
 * inside the page margins, less a little slack for rounding: A4 is the narrower sheet, short bond
 * the shorter one. A form laid out to this box prints on a single page of either.
 */
export const PRINT_PAGE_MARGIN_MM = 8;
export const PRINT_AREA_WIDTH_MM = 192;
export const PRINT_AREA_HEIGHT_MM = 261;
const CSS_PX_PER_MM = 96 / 25.4;

/*
 * The form print windows put the cloned sheet in a `.print-shell`. A long entry can still run past
 * one page after the print styles tighten the sheet, so it is scaled down just enough to fit. It is
 * laid out wider by the same factor it is shrunk by, so it still spans the full printable width. A
 * wider sheet is never taller, which makes `areaHeight / naturalHeight` a safe lower bound.
 */
export function fitSheetToPrintArea(printDocument) {
  const shell = printDocument.querySelector(".print-shell");
  const sheet = shell?.firstElementChild;
  if (!sheet) {
    return;
  }

  const areaWidth = PRINT_AREA_WIDTH_MM * CSS_PX_PER_MM;
  const areaHeight = PRINT_AREA_HEIGHT_MM * CSS_PX_PER_MM;
  const heightAtScale = (scale) => {
    sheet.style.setProperty("width", `${areaWidth / scale}px`, "important");
    return sheet.offsetHeight;
  };

  const naturalHeight = heightAtScale(1);
  if (naturalHeight <= areaHeight) {
    return;
  }

  let fits = areaHeight / naturalHeight;
  let overflows = 1;
  for (let step = 0; step < 6; step += 1) {
    const scale = (fits + overflows) / 2;
    if (heightAtScale(scale) * scale <= areaHeight) {
      fits = scale;
    } else {
      overflows = scale;
    }
  }

  const fittedHeight = heightAtScale(fits);
  sheet.style.transformOrigin = "top left";
  sheet.style.transform = `scale(${fits})`;
  shell.style.height = `${Math.floor(fittedHeight * fits)}px`;
}
