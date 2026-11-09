import React from "react";
import toast from "react-hot-toast";

export const DUPLICATE_LEAVE_DATE_CODE = "duplicate_leave_date";

/**
 * Show the duplicate-date response as a non-blocking React Hot Toast notification. The backend owns
 * the validation so this also catches stale tabs and direct/resubmitted requests.
 */
export function showDuplicateLeaveDateAlert(error) {
  const data = error?.response?.data;

  if (data?.code !== DUPLICATE_LEAVE_DATE_CODE) {
    return false;
  }

  const message = data.message || "You can't file leave on the same date more than once.";

  toast.error(
    React.createElement(
      "div",
      { style: { lineHeight: 1.4 } },
      React.createElement(
        "strong",
        { style: { display: "block", marginBottom: 2 } },
        "Leave date already filed"
      ),
      React.createElement("span", null, message)
    ),
    {
      id: DUPLICATE_LEAVE_DATE_CODE,
      duration: 3000,
    }
  );

  return true;
}
