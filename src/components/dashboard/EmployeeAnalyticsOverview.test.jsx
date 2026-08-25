import React from "react";
import { render, screen } from "@testing-library/react";
import EmployeeAnalyticsOverview from "./EmployeeAnalyticsOverview";
import { fetchAwardCycles } from "../../services/api";
import { fetchAttendanceRecords } from "../../services/attendanceService";
import {
  fetchCompensatoryCreditBalance,
  fetchCompensatoryRequests,
} from "../../services/compensatoryService";
import { fetchLeaveCredits, fetchLeaveRequests } from "../../services/leaveService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchPassSlips } from "../../services/passSlipService";
import { fetchTravelOrders } from "../../services/travelOrderService";

jest.mock("recharts", () => ({
  Area: () => null,
  AreaChart: () => null,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
jest.mock("./AdminStatCard", () => () => null);
jest.mock("./DashboardWelcomeBanner", () => () => null);
jest.mock("../chart/piechart", () => () => null);
jest.mock("../auto/autorefreshdatalist", () => ({ useAutoRefreshOnChange: jest.fn() }));
jest.mock("../../services/api", () => ({ fetchAwardCycles: jest.fn() }));
jest.mock("../../services/attendanceService", () => ({ fetchAttendanceRecords: jest.fn() }));
jest.mock("../../services/compensatoryService", () => ({
  fetchCompensatoryCreditBalance: jest.fn(),
  fetchCompensatoryRequests: jest.fn(),
}));
jest.mock("../../services/leaveService", () => ({
  fetchLeaveCredits: jest.fn(),
  fetchLeaveRequests: jest.fn(),
}));
jest.mock("../../services/overtimeService", () => ({ fetchOvertimeRequests: jest.fn() }));
jest.mock("../../services/passSlipService", () => ({ fetchPassSlips: jest.fn() }));
jest.mock("../../services/travelOrderService", () => ({ fetchTravelOrders: jest.fn() }));

describe("Employee attendance analytics", () => {
  test("excludes other employees from rendered-hour totals", async () => {
    const year = new Date().getFullYear();

    fetchLeaveCredits.mockResolvedValue({ credits: { balances: [], gender: "" } });
    fetchLeaveRequests.mockResolvedValue({ requests: [] });
    fetchTravelOrders.mockResolvedValue({ requests: [] });
    fetchPassSlips.mockResolvedValue({ records: [] });
    fetchCompensatoryRequests.mockResolvedValue({ records: [] });
    fetchCompensatoryCreditBalance.mockResolvedValue({ balance: {}, forfeitures: [] });
    fetchOvertimeRequests.mockResolvedValue({ records: [] });
    fetchAwardCycles.mockResolvedValue({ cycles: [], viewerKey: "" });
    fetchAttendanceRecords.mockResolvedValue({
      records: [
        {
          id: 1,
          employeeId: "EMP-OWN",
          employeeName: "Own Employee",
          date: `${year}-07-01`,
          totalMinutes: 480,
        },
        {
          id: 2,
          employeeId: "EMP-OTHER",
          employeeName: "Other Employee",
          date: `${year}-07-01`,
          /* With the own row, this recreates the incorrect organization-wide 2,463-hour total. */
          totalMinutes: 147270,
        },
      ],
    });

    render(
      <EmployeeAnalyticsOverview
        user={{ role: "employee", employee_id: "EMP-OWN", full_name: "Own Employee" }}
      />
    );

    expect(await screen.findByText(`Total in ${year}`)).not.toBeNull();
    expect(screen.getAllByText("8 hours")).toHaveLength(2);
    expect(screen.queryByText("2,463 hours")).toBeNull();
  });
});
