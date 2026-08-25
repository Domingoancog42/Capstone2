import React from "react";
import { render, screen } from "@testing-library/react";
import LeaveTable from "./LeaveTable";

const pendingLeave = {
  id: 1,
  employeeName: "Sample Employee",
  leaveType: "Vacation Leave",
  division: "Operations",
  dateFiled: "2026-08-25",
  numberOfDays: 1,
  status: "Pending",
};

describe("LeaveTable HR Staff actions", () => {
  test("keeps view and review available without approve, reject, or cancel buttons", () => {
    render(
      <LeaveTable
        rows={[pendingLeave]}
        canManage
        roleKey="hrstaff"
        canManageRow={() => true}
      />
    );

    expect(screen.getAllByRole("button", { name: "Review leave request" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "View leave form" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /approve leave request/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject leave request/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel leave request/i })).toBeNull();
  });

  test("does not show decision buttons for an HR Staff monetization row", () => {
    render(
      <LeaveTable
        rows={[{ ...pendingLeave, isLeaveMonetization: true }]}
        canManage
        roleKey="hrstaff"
        canManageRow={() => true}
      />
    );

    expect(screen.queryByRole("button", { name: /approve leave monetization/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject leave monetization/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel leave monetization/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: "View leave monetization form" }).length).toBeGreaterThan(0);
  });
});
