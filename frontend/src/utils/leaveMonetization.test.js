import { resolveMonetizationRowActions } from "./leaveMonetization";

const stages = [
  ["Pending", "hrstaff", "Endorsed"],
  ["Endorsed", "hrhead", "Reviewed"],
  ["Reviewed", "chief", "Chief Reviewed"],
  ["Chief Reviewed", "regionaldirector", "Approved"],
];

test.each(stages)("%s is owned by %s and advances to %s", (status, owner, nextStatus) => {
  for (const roleKey of ["hrstaff", "hrhead", "chief", "regionaldirector", "employee", "admin"]) {
    const actions = resolveMonetizationRowActions({ roleKey, record: { status }, isOwnRecord: false });
    expect(actions.showApprove).toBe(roleKey === owner || roleKey === "admin");
    expect(actions.showReject).toBe(roleKey === owner || roleKey === "admin");
    expect(actions.nextStatus).toBe(nextStatus);
  }
});

test.each(["Approved", "Rejected", "Cancelled"])("%s has no further approval actions", (status) => {
  for (const roleKey of ["admin", "hrstaff", "hrhead", "chief", "regionaldirector"]) {
    const actions = resolveMonetizationRowActions({ roleKey, record: { status }, isOwnRecord: false });
    expect(actions.showApprove || actions.showReject || actions.showCancel).toBe(false);
  }
});

test.each(stages)("applicants cannot approve their own %s request", (status, roleKey) => {
  const actions = resolveMonetizationRowActions({ roleKey, record: { status }, isOwnRecord: true });
  expect(actions.showApprove || actions.showReject).toBe(false);
  expect(actions.showOwnCancel).toBe(status === "Pending");
});
