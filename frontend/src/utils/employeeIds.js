export function employeeIdSequenceNumber(value) {
  const employeeId = String(value || "").trim();
  const match = employeeId.match(/^(?:EMP\d{4}-)?(\d+)$/i);

  if (!match) {
    return null;
  }

  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildNextEmployeeId(employees = []) {
  const maxNumber = employees.reduce((max, employee) => {
    const number = employeeIdSequenceNumber(employee?.employeeId);
    return number === null ? max : Math.max(max, number);
  }, 0);

  return String(maxNumber + 1).padStart(4, "0");
}
