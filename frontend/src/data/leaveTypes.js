export const LEAVE_TYPES = [
  "Vacation Leave",
  "Mandatory/Forced Leave",
  "Sick Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Special Privilege Leave",
  "Solo Parent Leave",
  "Study Leave",
  "10-Day VAWC Leave",
  "Rehabilitation Privilege",
  "Special Leave Benefits for Women",
  "Special Emergency (Calamity) Leave",
  "Adoption Leave",
  "Emergency Leave",
  "Leave Without Pay",
];

/*
 * Monetizing unused credits is filed on the same CSC Form No. 6 as a leave, under "Other purpose"
 * in 6.B rather than as a leave type of its own, so it is not part of LEAVE_TYPES: no employee
 * holds a balance of it and no credit is deducted for the days it covers. It is offered in the
 * leave request form's type selection because that is where the filing starts, and the request
 * itself is kept by leave_monetization.php.
 */
export const LEAVE_MONETIZATION_TYPE = "Monetization of Leave Credits";

/** The leave types the request form offers, which is every leave plus the monetization filing. */
export const LEAVE_REQUEST_TYPES = [...LEAVE_TYPES, LEAVE_MONETIZATION_TYPE];

/*
 * The checklist printed in 6.A of CSC Form No. 6, in the order the form lists it. Leave Without Pay
 * and Emergency Leave are not on that sheet, which is why this is not LEAVE_TYPES: the printed form
 * has to match the paper it stands in for. Both forms that print the sheet -- the leave request and
 * the monetization -- draw their checklist from here so the two cannot drift apart.
 */
export const CSC_FORM_LEAVE_TYPES = [
  "Vacation Leave",
  "Mandatory/Forced Leave",
  "Sick Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Special Privilege Leave",
  "Solo Parent Leave",
  "Study Leave",
  "10-Day VAWC Leave",
  "Rehabilitation Privilege",
  "Special Leave Benefits for Women",
  "Special Emergency (Calamity) Leave",
  "Adoption Leave",
];

function normalizeLeaveTypeName(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * The printed checklist plus any leave type an administrator has added since, so a filing under a
 * configured type still has a box of its own to tick.
 */
export function mergeCscLeaveTypes(configuredLeaveTypes) {
  const merged = [...CSC_FORM_LEAVE_TYPES];
  const seen = new Set(merged.map(normalizeLeaveTypeName));

  (configuredLeaveTypes || []).forEach((leaveType) => {
    const name = String(leaveType?.name ?? leaveType ?? "").trim();
    const normalized = normalizeLeaveTypeName(name);

    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    merged.push(name);
  });

  return merged;
}

export function isLeaveMonetizationType(value) {
  return String(value || "").trim().toLowerCase() === LEAVE_MONETIZATION_TYPE.toLowerCase();
}

export const DIVISIONS = [
  "Administration",
  "Finance",
  "Human Resources",
  "Operations",
  "Regional Office",
  "IT Services",
];

export const LEAVE_STATUSES = [
  "Submitted",
  "Pending Leave Balance Verification",
  "Pending HR Head Approval",
  "Pending Division Chief Review",
  "Pending Regional Director Approval",
  "Approved",
  "Disapproved",
  "Cancelled",
];
