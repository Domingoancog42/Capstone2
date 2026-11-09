/*
 * Payload builders for the QR codes printed on the leave and travel order forms.
 *
 * The payload is plain labeled text rather than a URL or JSON blob so that any off-the-shelf phone
 * scanner shows the record details straight away -- the printed copy stays readable even when the
 * HRIS is unreachable, which is the point of carrying the data on the paper itself.
 *
 * Everything here is in service of one budget: the printed module size. A QR grows by four modules
 * per version, and the block on the form is a fixed number of millimetres wide, so every character
 * added makes the printed squares smaller. Below roughly 0.4mm a module stops resolving on a phone
 * camera, which is why the labels are terse and the free-text fields are clipped.
 */

// Longest a single free-text field (purpose, destination, division) may contribute. Chosen so that a
// worst-case record still encodes within the version budget measured for these forms.
const MAX_FREE_TEXT_LENGTH = 60;

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength = MAX_FREE_TEXT_LENGTH) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/* Lines without a value are dropped so an unfilled field never becomes a dangling "Label:" on scan. */
function buildPayload(title, lines) {
  const body = lines
    .filter(([, value]) => cleanText(value) !== "")
    .map(([label, value]) => `${label}: ${cleanText(value)}`);

  return [title, ...body].join("\n");
}

function formatStatus(status) {
  const text = cleanText(status);
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : "";
}

export function buildLeaveRequestReference(request) {
  const year = String(request?.dateFiled || request?.startDate || "").slice(0, 4)
    || String(new Date().getFullYear());
  const id = String(request?.id ?? "").trim();

  return id ? `LR-${id.padStart(4, "0")}-${year}` : "";
}

export function buildLeaveRequestQrPayload(request, formData = {}) {
  const leaveType = cleanText(formData.leaveType)
    || cleanText(formData.leaveTypeOther)
    || cleanText(request?.leaveType);

  return buildPayload("MGB-X APPLICATION FOR LEAVE", [
    ["Ref", buildLeaveRequestReference(request)],
    ["Name", truncate(formData.applicantName || request?.employeeName)],
    ["ID", request?.employeeId],
    ["Office", truncate(formData.office)],
    ["Position", truncate(formData.position)],
    ["Type", truncate(leaveType)],
    ["Days", formData.numberOfDays || request?.numberOfDays],
    ["Dates", formData.inclusiveDates],
    ["Filed", formData.dateOfFiling || request?.dateFiled],
    ["Status", formatStatus(request?.status)],
    ["Certified", truncate(request?.reviewedByName)],
    ["Approved", truncate(request?.approvedByName)],
  ]);
}

export function buildLeaveMonetizationReference(record) {
  const year = String(record?.dateFiled || "").slice(0, 4) || String(new Date().getFullYear());
  const id = String(record?.id ?? "").trim();

  return id ? `LM-${id.padStart(4, "0")}-${year}` : "";
}

/*
 * The monetization filing prints on the same CSC Form No. 6 as a leave request, so its QR carries
 * the same fields in the same order. "Dates" has no meaning here -- the days come off a credit
 * rather than a calendar -- so the credit being monetized takes that line instead.
 */
export function buildLeaveMonetizationQrPayload(record, formData = {}) {
  return buildPayload("MGB-X APPLICATION FOR LEAVE", [
    ["Ref", buildLeaveMonetizationReference(record)],
    ["Name", truncate(formData.applicantName || record?.employeeName)],
    ["ID", record?.employeeId],
    ["Office", truncate(formData.office)],
    ["Position", truncate(formData.position)],
    ["Type", "Monetization of Leave Credits"],
    ["Credit", truncate(formData.leaveType || record?.leaveType)],
    ["Days", formData.numberOfDays || record?.numberOfDays],
    ["Filed", formData.dateOfFiling || record?.dateFiled],
    ["Status", formatStatus(record?.status)],
    ["Certified", truncate(record?.reviewedByName)],
    ["Approved", truncate(record?.approvedByName)],
  ]);
}

export function buildTravelOrderQrPayload(request, { travelOrderNumber = "", perDiems = null } = {}) {
  return buildPayload("MGB-X TRAVEL ORDER", [
    ["Ref", travelOrderNumber ? `TO-${travelOrderNumber}` : ""],
    ["Name", truncate(request?.employeeName)],
    // No employee ID line here: the travel order carries more fields than the leave form, and the
    // reference plus name already identify the record without spending modules on it.
    ["Position", truncate(request?.position)],
    ["Division", truncate(request?.division)],
    ["Destination", truncate(request?.destination)],
    ["Purpose", truncate(request?.purpose)],
    ["Departure", request?.startDate],
    ["Arrival", request?.endDate],
    ["Per Diems", perDiems === null ? "" : (perDiems ? "Yes" : "No")],
    ["Filed", request?.dateFiled],
    ["Status", formatStatus(request?.status)],
    ["Recommended", truncate(request?.recommendedBy)],
    ["Approved", truncate(request?.approvedBy)],
  ]);
}
