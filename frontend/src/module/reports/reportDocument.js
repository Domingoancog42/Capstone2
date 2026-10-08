export const ORGANIZATION_NAME = "Mines and Geosciences Bureau - 10";
export const ORGANIZATION_SUBTITLE = "DENR Region X, Macabalan, Cagayan de Oro City";
export const ORGANIZATION_LOGO = "/mgb.png";

export function reportPrintColumns(report) {
  return (report.columns || []).filter((column) => column.key !== "status" || report.isAggregate || report.keepStatus);
}
