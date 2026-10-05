import api from "./api";

export async function fetchPayslipData(params = {}) {
  const response = await api.get("/payslip.php", { params });
  return response.data;
}

export async function fetchPayslipPeriods(params = {}) {
  const response = await api.get("/payslip.php", {
    params: {
      ...params,
      action: "periods",
    },
  });
  return response.data;
}

export async function fetchPayslipRecord(payrollId, params = {}) {
  const response = await api.get("/payslip.php", {
    params: {
      ...params,
      action: "detail",
      payroll_id: payrollId,
    },
  });
  return response.data;
}

export async function fetchBulkPayslipData(employeeIds = [], params = {}) {
  const response = await api.get("/payslip.php", {
    params: {
      ...params,
      employee_ids: employeeIds.join(","),
    },
  });
  return response.data;
}

export async function fetchPayslipSummary(employeeIds = []) {
  const response = await api.get("/payslip.php", {
    params: {
      action: "summary",
      employee_ids: employeeIds.join(","),
    },
  });
  return response.data;
}

export async function generateBulkPayslipZip(employeeIds = []) {
  const response = await api.get("/payslip.php", {
    params: {
      action: "bulk_zip",
      employee_ids: employeeIds.join(","),
    },
    responseType: "blob",
  });
  const disposition = response.headers?.["content-disposition"] || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

  return {
    blob: response.data,
    filename: filenameMatch?.[1] || `payslips-${new Date().toISOString().slice(0, 10)}.zip`,
  };
}
