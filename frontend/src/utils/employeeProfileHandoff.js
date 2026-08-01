export const EMPLOYEE_PROFILE_HANDOFF_KEY = "hris:employee-profile-handoff";

function normalizeEmployeeTarget(employee) {
  const employeeRecordId = employee?.employeeRecordId || employee?.id || "";
  const employeeId = employee?.employeeId || "";

  return {
    employeeRecordId: String(employeeRecordId || ""),
    employeeId: String(employeeId || ""),
  };
}

export function saveEmployeeProfileHandoff(employee) {
  if (typeof window === "undefined") {
    return;
  }

  const target = normalizeEmployeeTarget(employee);

  if (!target.employeeRecordId && !target.employeeId) {
    return;
  }

  window.sessionStorage.setItem(EMPLOYEE_PROFILE_HANDOFF_KEY, JSON.stringify(target));
}

export function consumeEmployeeProfileHandoff() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(EMPLOYEE_PROFILE_HANDOFF_KEY);
  window.sessionStorage.removeItem(EMPLOYEE_PROFILE_HANDOFF_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return normalizeEmployeeTarget(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function findEmployeeFromProfileHandoff(employees = [], target = null) {
  if (!target) {
    return null;
  }

  return employees.find((employee) => {
    const recordMatches = target.employeeRecordId
      && String(employee?.id || employee?.employeeRecordId || "") === target.employeeRecordId;
    const codeMatches = target.employeeId
      && String(employee?.employeeId || "") === target.employeeId;

    return recordMatches || codeMatches;
  }) || null;
}
