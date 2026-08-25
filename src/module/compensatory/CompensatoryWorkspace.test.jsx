import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CompensatoryWorkspace from "./CompensatoryWorkspace";
import {
  fetchCompensatoryRequests,
  updateCompensatoryStatus,
} from "../../services/compensatoryService";
import Swal from "sweetalert2";
import { toast } from "react-hot-toast";

jest.mock("../../services/compensatoryService", () => ({
  fetchCompensatoryCreditBalance: jest.fn(),
  fetchCompensatoryRequests: jest.fn(),
  fileCompensatoryRequest: jest.fn(),
  updateCompensatoryStatus: jest.fn(),
}));
jest.mock("../../components/auto/autorefreshdatalist", () => ({
  useAutoRefreshOnChange: jest.fn(),
}));
jest.mock("sweetalert2", () => ({ fire: jest.fn() }));
jest.mock("react-hot-toast", () => {
  const toastMock = jest.fn();
  toastMock.loading = jest.fn();
  toastMock.success = jest.fn();
  toastMock.error = jest.fn();
  return { toast: toastMock };
});

describe("Chief compensatory request actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("shows Approve and Reject without a Cancel action", async () => {
    fetchCompensatoryRequests.mockResolvedValue({
      records: [{
        id: 10,
        employeeRecordId: 10,
        employeeId: "EMP-010",
        employeeName: "Employee Ten",
        division: "Finance Division",
        hoursApplied: 8,
        startDate: "2026-08-28",
        endDate: "2026-08-28",
        remarks: "CTO request",
        status: "Pending",
        dateFiled: "2026-08-25",
      }],
    });

    render(
      <CompensatoryWorkspace
        user={{ role: "chief", employee_id: "CHIEF-001", full_name: "Division Chief" }}
      />
    );

    expect(await screen.findAllByRole("button", { name: "Approve and forward to HR Head" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reject compensatory request" })).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: "Cancel compensatory request" })).toHaveLength(0);
  });

  test("hides Cancel from the Regional Director", async () => {
    fetchCompensatoryRequests.mockResolvedValue({
      records: [{
        id: 12,
        employeeRecordId: 12,
        employeeId: "EMP-012",
        employeeName: "Employee Twelve",
        division: "Finance Division",
        hoursApplied: 8,
        startDate: "2026-08-30",
        endDate: "2026-08-30",
        remarks: "CTO request",
        status: "Reviewed",
        dateFiled: "2026-08-25",
      }],
    });

    render(
      <CompensatoryWorkspace
        user={{
          role: "regionaldirector",
          employee_id: "RD-001",
          full_name: "Regional Director",
        }}
      />
    );

    expect(await screen.findAllByRole("button", { name: "Approve compensatory request" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reject compensatory request" })).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: "Cancel compensatory request" })).toHaveLength(0);
  });

  test("uses React Hot Toast after rejecting a request", async () => {
    const pendingRecord = {
      id: 11,
      employeeRecordId: 11,
      employeeId: "EMP-011",
      employeeName: "Employee Eleven",
      division: "Finance Division",
      hoursApplied: 8,
      startDate: "2026-08-29",
      endDate: "2026-08-29",
      remarks: "CTO request",
      status: "Pending",
      dateFiled: "2026-08-25",
    };
    fetchCompensatoryRequests.mockResolvedValue({ records: [pendingRecord] });
    Swal.fire.mockResolvedValue({ isConfirmed: true, value: "Needs correction" });
    toast.loading.mockReturnValue("cto-status-toast");
    updateCompensatoryStatus.mockResolvedValue({
      record: { ...pendingRecord, status: "Rejected", rejectedNote: "Needs correction" },
      message: "Compensatory request rejected.",
      emailNotification: "sent",
    });

    render(
      <CompensatoryWorkspace
        user={{ role: "chief", employee_id: "CHIEF-001", full_name: "Division Chief" }}
      />
    );

    fireEvent.click((await screen.findAllByRole("button", { name: "Reject compensatory request" }))[0]);

    await waitFor(() => {
      expect(updateCompensatoryStatus).toHaveBeenCalledWith(
        11,
        "Rejected",
        "Needs correction",
        {}
      );
    });
    expect(toast.loading).toHaveBeenCalledWith("Rejecting compensatory time off request...");
    expect(toast.success).toHaveBeenCalledWith(
      "Compensatory request rejected.",
      { id: "cto-status-toast" }
    );
    expect(Swal.fire).toHaveBeenCalledTimes(1);
  });
});
