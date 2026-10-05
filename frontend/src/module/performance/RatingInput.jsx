import React from "react";
import InputField from "../../components/UI/InputField";

export default function RatingInput({ value, onValueChange, ...props }) {
  const handleChange = (event) => {
    const nextValue = event.target.value;
    if (nextValue === "") {
      onValueChange("");
      return;
    }

    const score = Number(nextValue);
    if (!Number.isFinite(score)) return;

    onValueChange(score < 1 ? "1" : score > 5 ? "5" : nextValue);
  };

  return (
    <InputField
      {...props}
      type="number"
      min="1"
      max="5"
      step="0.01"
      value={value}
      onChange={handleChange}
    />
  );
}
