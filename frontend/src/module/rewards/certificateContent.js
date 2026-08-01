import { categoryDetail } from "./rewardsConstants";
import { isoNow, monthName, ordinalDay, text, yearValue } from "./rewardsUtils";

/**
 * The single source of truth for what a certificate says.
 *
 * The on-screen preview is React and the printable copy is a standalone HTML document, so the two
 * cannot share markup. They must not drift on wording, which is the part anyone actually reads —
 * both build from this.
 */

const BODY_TEXT =
  "In acknowledgement of your exceptional skills, dedication, and excellence, we extend our sincere appreciation for your consistent hard work and unwavering commitment. Your contributions are truly valued.";

const PLACE = "Mines Geoscience Bureau, Puntod, Cagayan de Oro City";

export function certificateContent(record = {}) {
  const detail = categoryDetail(record.category);
  const isLoyalty = detail.usesYearsOfService;
  const issuedAt = record.certificate?.issuedAt || isoNow();

  return {
    isLoyalty,
    accent: detail.certificateAccent,
    heading: "Certificate of Recognition",
    presentedTo: "Presented To",
    recipient: text(record.employeeName, "Unnamed Employee"),
    nomineeLabel: isLoyalty ? "LOYALTY AWARD NOMINEE" : "BEST EMPLOYEE NOMINEE",
    categoryLine: `${text(record.employmentType, "Employment").toUpperCase()} CATEGORY`,
    // Loyalty leads with the milestone; the monthly award leads with its certificate number.
    categoryMark: isLoyalty
      ? `${record.yearsOfService || ""}${record.yearsOfService ? " Years" : "Service Award"}`
      : "Excellence Award",
    certificateNumber: record.certificate?.number || "",
    body: BODY_TEXT,
    given: `Given this ${ordinalDay(issuedAt)} day of ${monthName(issuedAt)} ${yearValue(issuedAt)} at ${PLACE}`,
    signatory: text(record.certificate?.signatoryTitle, "OIC Regional Executive Director"),
    organisation: "Mines and Geosciences Bureau",
  };
}
