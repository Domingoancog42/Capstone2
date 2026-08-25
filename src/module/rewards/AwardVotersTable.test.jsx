import React from "react";
import { render, screen } from "@testing-library/react";
import AwardVotersTable from "./AwardVotersTable";

describe("AwardVotersTable voter profiles", () => {
  test("does not borrow an employee photo when an admin user id matches an employee id", () => {
    const { container } = render(
      <AwardVotersTable
        employees={[{
          id: "1",
          fullName: "Louisse Kaye P. Aba",
          profileImage: "uploads/profile-images/employee-1.jpg",
        }]}
        nominations={[{
          id: "vote-1",
          voterKey: "1",
          voterEmployeeKey: "",
          voterName: "admin",
          nomineeKey: "1",
          nomineeName: "Louisse Kaye P. Aba",
          reason: "",
          createdAt: "2026-08-23 22:54:00",
        }]}
      />,
    );

    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("A")).toBeNull();
  });
});
