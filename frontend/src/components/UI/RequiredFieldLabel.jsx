import React from "react";

export function RequiredFieldMarker() {
  return (
    <span
      className="app-required-marker ml-0.5 font-bold !text-[#D61E1E]"
      aria-hidden="true"
    >
      *
    </span>
  );
}

export function decorateRequiredFieldLabel(label) {
  if (typeof label !== "string" || !label.endsWith(" *")) {
    return label;
  }

  return (
    <>
      {label.slice(0, -2)}
      <RequiredFieldMarker />
    </>
  );
}
