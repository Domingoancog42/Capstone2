import React from "react";

// Bands and colours defined by the office rating scale.
// `className` is the solid badge fill; `scoreClassName` is the softer tint used by
// the Average column so the two adjacent columns do not both read as solid blocks.
const performanceBands = [
  {
    min: 4.5,
    label: "Outstanding",
    className: "border-[#2563EB] bg-[#2563EB] text-[#FFFFFF]",
    scoreClassName: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
  },
  {
    min: 3.5,
    label: "Very Satisfactory",
    className: "border-[#22C55E] bg-[#22C55E] text-[#FFFFFF]",
    scoreClassName: "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]",
  },
  {
    min: 2.5,
    label: "Satisfactory",
    className: "border-[#F59E0B] bg-[#F59E0B] text-[#1F2937]",
    scoreClassName: "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]",
  },
  {
    min: 1.5,
    label: "Unsatisfactory",
    className: "border-[#EA580C] bg-[#EA580C] text-[#FFFFFF]",
    scoreClassName: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]",
  },
  {
    min: 0.01,
    label: "Poor",
    className: "border-[#DC2626] bg-[#DC2626] text-[#FFFFFF]",
    scoreClassName: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
  },
];

const notRatedBand = {
  label: "Not Rated",
  className: "border-slate-200 bg-slate-100 text-slate-500",
  scoreClassName: "border-slate-200 bg-slate-50 text-slate-500",
};

function toScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

export function performanceBand(value) {
  return performanceBands.find((band) => toScore(value) >= band.min) || notRatedBand;
}

export function RatingScore({ value, emphasis = false }) {
  const score = toScore(value);

  if (score === 0) {
    return <span className="text-slate-400">--</span>;
  }

  // The Average column (emphasis) is colour-coded by band so the score itself
  // signals performance at a glance, not just the adjectival label beside it.
  if (emphasis) {
    const band = performanceBand(score);

    return (
      <span
        className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-sm font-extrabold tabular-nums ${band.scoreClassName}`}
        title={band.label}
      >
        {score.toFixed(2)}
      </span>
    );
  }

  return <span className="tabular-nums font-semibold text-slate-700">{score.toFixed(2)}</span>;
}

export function PerformanceBandBadge({ value }) {
  const band = performanceBand(value);

  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${band.className}`}>
      {band.label}
    </span>
  );
}

export function RemarksCell({ value }) {
  const remarks = String(value ?? "").trim();

  if (!remarks) {
    return <span className="italic text-slate-400">No remarks</span>;
  }

  return (
    <span className="block max-w-[280px] truncate text-slate-700" title={remarks}>
      {remarks}
    </span>
  );
}
