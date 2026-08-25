import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import Sidebar, { countPendingCompensatoryRequests } from "./Sidebar";
import { fetchLeaveRequests } from "../../services/leaveService";
import { fetchTravelOrders } from "../../services/travelOrderService";
import { fetchCompensatoryRequests } from "../../services/compensatoryService";
import { fetchOvertimeRequests } from "../../services/overtimeService";
import { fetchLeaveMonetizationRequests } from "../../services/leaveMonetizationService";
import { subscribeAutoRefresh } from "../../components/auto/autorefreshconfig";

jest.mock("framer-motion", () => {
  const React = require("react");
  const components = {};
  const motion = new Proxy({}, {
    get: (_, tag) => {
      if (!components[tag]) {
        components[tag] = React.forwardRef(({
          animate,
          initial,
          exit,
          transition,
          variants,
          whileHover,
          whileTap,
          layoutId,
          children,
          ...props
        }, ref) => React.createElement(tag, { ...props, ref }, children));
      }

      return components[tag];
    },
  });

  return {
    AnimatePresence: ({ children }) => <>{children}</>,
    LayoutGroup: ({ children }) => <>{children}</>,
    motion,
    useReducedMotion: () => true,
  };
});

jest.mock("../../services/leaveService", () => ({
  fetchLeaveRequests: jest.fn(),
  LEAVE_REQUESTS_CHANGED_EVENT: "leave-requests:changed",
}));
jest.mock("../../services/travelOrderService", () => ({ fetchTravelOrders: jest.fn() }));
jest.mock("../../services/compensatoryService", () => ({ fetchCompensatoryRequests: jest.fn() }));
jest.mock("../../services/overtimeService", () => ({ fetchOvertimeRequests: jest.fn() }));
jest.mock("../../services/loanService", () => ({ fetchLoanRequests: jest.fn() }));
jest.mock("../../services/leaveMonetizationService", () => ({ fetchLeaveMonetizationRequests: jest.fn() }));
jest.mock("../../services/payrollService", () => ({ fetchPayrollRecords: jest.fn() }));
jest.mock("../../components/auto/autorefreshconfig", () => ({
  subscribeAutoRefresh: jest.fn(() => jest.fn()),
}));

const compensatoryRecords = [
  { id: 1, status: "Pending" },
  { id: 2, status: "Pending" },
  { id: 3, status: "Endorsed" },
  { id: 4, status: "Reviewed" },
  { id: 5, status: "Approved" },
];

describe("Sidebar compensatory notification count", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeAutoRefresh.mockReturnValue(jest.fn());
    fetchCompensatoryRequests.mockResolvedValue({ records: compensatoryRecords });
    fetchOvertimeRequests.mockResolvedValue({ records: [] });
  });

  test("counts only the CTO requests waiting at each approval desk", () => {
    expect(countPendingCompensatoryRequests(compensatoryRecords, "chief")).toBe(2);
    expect(countPendingCompensatoryRequests(compensatoryRecords, "hrhead")).toBe(1);
    expect(countPendingCompensatoryRequests(compensatoryRecords, "regionaldirector")).toBe(1);
    expect(countPendingCompensatoryRequests(compensatoryRecords, "admin")).toBe(4);
  });

  test("fetches and displays the chief's pending CTO count", async () => {
    const Icon = () => <span aria-hidden="true" />;

    render(
      <Sidebar
        user={{ role: "chief", full_name: "Division Chief" }}
        activeModule="cto"
        navigationItems={[{
          key: "leave",
          label: "Leave Management",
          icon: Icon,
          path: "/chief/leave",
          children: [{
            key: "cto",
            label: "Compensatory Time Off",
            path: "/chief/leave/compensatory-time-off",
          }],
        }]}
      />
    );

    await waitFor(() => expect(fetchCompensatoryRequests).toHaveBeenCalled());

    const ctoLink = await screen.findByRole("link", { name: /Compensatory Time Off/ });
    expect(within(ctoLink).getByText("2")).not.toBeNull();
  });

  test("does not show Leave or Travel Order notification counts for HR Staff", async () => {
    fetchLeaveRequests.mockResolvedValue({ requests: [{ id: 1, status: "Pending" }] });
    fetchTravelOrders.mockResolvedValue({ requests: [{ id: 2, status: "Pending" }] });
    fetchLeaveMonetizationRequests.mockResolvedValue({ records: [{ id: 3, status: "Pending" }] });
    const Icon = () => <span aria-hidden="true" />;

    render(
      <Sidebar
        user={{ role: "hrstaff", full_name: "HR Staff User" }}
        activeModule="leave"
        navigationItems={[{
          key: "leave",
          label: "Leave Management",
          icon: Icon,
          path: "/hrstaff/leave",
          children: [
            { key: "leave", label: "Leave", path: "/hrstaff/leave", exact: true },
            { key: "travel", label: "Travel Order", path: "/hrstaff/leave/travel-order" },
          ],
        }]}
      />
    );

    await waitFor(() => expect(fetchOvertimeRequests).toHaveBeenCalled());

    const leaveLink = await screen.findByRole("link", { name: "Leave" });
    const travelLink = screen.getByRole("link", { name: "Travel Order" });
    expect(within(leaveLink).queryByText("1")).toBeNull();
    expect(within(travelLink).queryByText("1")).toBeNull();
    expect(fetchLeaveRequests).not.toHaveBeenCalled();
    expect(fetchTravelOrders).not.toHaveBeenCalled();
    expect(fetchLeaveMonetizationRequests).not.toHaveBeenCalled();
  });
});
