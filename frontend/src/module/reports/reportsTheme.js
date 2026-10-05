import { useCallback, useEffect, useRef, useState } from "react";
import { numberFormatter, wholeCurrencyFormatter as currencyFormatter } from "../../utils/format";

/**
 * Chart tokens for the Reports dashboard.
 *
 * The categorical order is fixed — a series keeps its hue no matter how many
 * other series are on screen, so filtering never repaints the survivors. Both
 * columns were validated against this app's real chart surfaces (#ffffff and
 * the html.dark override #0f172a) for the lightness band, chroma floor,
 * colour-vision-deficiency separation, and contrast.
 */
const LIGHT_THEME = {
  mode: "light",
  surface: "#ffffff",
  plane: "#f8fafc",
  grid: "#e2e8f0",
  axis: "#94a3b8",
  baseline: "#cbd5e1",
  text: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#64748b",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  sequential: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95"],
  ordinal: ["#86b6ef", "#599be8", "#307edc", "#2164b7", "#164c91", "#0d366b"],
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  deltaUp: "#006300",
  deltaDown: "#d03b3b",
};

const DARK_THEME = {
  mode: "dark",
  surface: "#0f172a",
  plane: "#020617",
  grid: "#1e293b",
  axis: "#64748b",
  baseline: "#334155",
  text: "#f8fafc",
  textSecondary: "#cbd5e1",
  textMuted: "#94a3b8",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  sequential: ["#0d366b", "#104281", "#184f95", "#256abf", "#2a78d6", "#3987e5", "#6da7ec"],
  ordinal: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9dc5f4", "#cde2fb"],
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  deltaUp: "#0ca30c",
  deltaDown: "#e66767",
};

/**
 * The categorical order carries eight slots and is never cycled — a ninth generated hue is
 * indistinguishable from an existing one under colour-vision deficiency.
 *
 * Eight distinct hues are safe on a **bar** chart, where only neighbouring bars touch and the
 * adjacent pairlist applies (worst adjacent CVD ΔE 9.1 light / 8.4 dark). They are NOT safe on a
 * pie or donut, where every slice is compared against every other: on that all-pairs pairlist the
 * order clears only its first three slots. Reach for distinct hues on bars; keep pies to three
 * slices or switch the form.
 */
export const SERIES_SLOT_COUNT = 8;

/** Loose match so "HR Head", "HRHead" and "hr_head" all land on the same slot. */
export function normalizeEntityKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The built-in roles get pinned slots, so a role keeps its colour on every screen and whether or
 * not the other roles happen to be populated. Custom roles (the app lets HR create them) take the
 * remaining slots in stable name order.
 */
export const ROLE_SLOTS = {
  admin: 0,
  regionaldirector: 1,
  hrhead: 2,
  hrstaff: 3,
  chief: 4,
  employee: 5,
  planningofficer: 6,
  cashier: 7,
};

/**
 * Stable entity → slot assignment.
 *
 * The slot is derived from the entity's own name, never from its position in the data. That is the
 * whole point: these charts are ranked, so position moves whenever the numbers move, and colouring
 * by position means a division that climbs one place changes colour — and so does everything it
 * passed. Sorting the names gives an assignment that only changes when the set of entities changes.
 *
 * Returns a Map of key → slot index, or `null` for entities past the eighth. Callers render those
 * in a muted tone rather than inventing a ninth hue; on a ranked chart they are the tail, and the
 * axis label still names every bar.
 *
 * Pass the **full** entity list, not the filtered-for-display subset: the assignment depends on the
 * set it is given, so resolving against only the rows currently on screen would move an entity's
 * colour whenever a different entity dropped out — the same repaint bug, one level up.
 */
export function assignEntitySlots(names, pinned = {}) {
  const keys = Array.from(new Set(names.map((name) => normalizeEntityKey(name)))).filter(Boolean);
  const slots = new Map();

  /*
   * Every pinned slot is reserved whether or not that entity appears in this dataset. Reserving
   * only the ones present would hand a custom role a built-in role's slot on screens where the
   * built-in happens to have no rows, so the custom role would change colour from page to page.
   */
  const reserved = new Set(
    Object.values(pinned).filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < SERIES_SLOT_COUNT)
  );

  keys.forEach((key) => {
    const slot = pinned[key];
    if (slot !== undefined && slot < SERIES_SLOT_COUNT) {
      slots.set(key, slot);
    }
  });

  const free = [];
  for (let slot = 0; slot < SERIES_SLOT_COUNT; slot += 1) {
    if (!reserved.has(slot)) {
      free.push(slot);
    }
  }

  keys
    .filter((key) => !slots.has(key))
    .sort((left, right) => left.localeCompare(right))
    .forEach((key, index) => {
      slots.set(key, index < free.length ? free[index] : null);
    });

  return slots;
}

/**
 * Gives each bar of a single-series chart the hue of the entity it stands for (a division, an
 * appointment type, a leave type), keyed to its name through `assignEntitySlots`.
 *
 * The rows come back in **slot order**, not value order. Only neighbouring bars touch, and
 * consecutive slots are what the eight-slot order was validated for; sorting by value would put
 * arbitrary slots side by side (yellow beside orange fails the floors). Bar length still carries
 * the ranking. Entities past the eighth take the muted token rather than a ninth hue.
 *
 * Pass `names` when another chart colours the same entities, so both resolve against one set.
 */
export function colorEntityRows(rows, theme, names = rows.map((row) => row.label)) {
  const slots = assignEntitySlots(names);

  return rows
    .map((row) => {
      const slot = slots.get(normalizeEntityKey(row.label));
      const hasSlot = slot !== null && slot !== undefined;

      return {
        ...row,
        slot: hasSlot ? slot : SERIES_SLOT_COUNT,
        color: hasSlot ? theme.series[slot] : theme.textMuted,
      };
    })
    .sort((left, right) => left.slot - right.slot || (Number(right.value) || 0) - (Number(left.value) || 0));
}

/**
 * Colours ordered bands (age bands, years of service, salary brackets, balance ranges) with the
 * ordinal ramp: one hue, light to dark in the order the bands run, so the colour reads as the order.
 *
 * `theme.ordinal` holds six steps spaced evenly in OKLab lightness along the documented blue ramp,
 * validated with `validate_palette.js --ordinal` against each mode's surface (monotone, every
 * adjacent gap >= 0.06, the step nearest the surface >= 2:1). Fewer bands take evenly spaced steps
 * from it; past six the steps would blur, so the bands fall back to one hue.
 *
 * `order` lists the band labels in their natural order, for series the API does not return in that
 * order. Labels outside it -- "Unspecified" -- are not a band: they go last, in the muted token.
 */
export function colorOrdinalRows(rows, theme, order = null) {
  const isBand = (row) => (
    order ? order.includes(row.label) : normalizeEntityKey(row.label) !== "unspecified"
  );
  const bands = rows.filter(isBand);
  const rest = rows.filter((row) => !isBand(row));

  if (order) {
    bands.sort((left, right) => order.indexOf(left.label) - order.indexOf(right.label));
  }

  const ramp = theme.ordinal;
  const stepFor = (index) => {
    if (bands.length > ramp.length) {
      return theme.series[0];
    }

    return bands.length === 1
      ? ramp[ramp.length - 1]
      : ramp[Math.round((index * (ramp.length - 1)) / (bands.length - 1))];
  };

  return [
    ...bands.map((row, index) => ({ ...row, color: stepFor(index) })),
    ...rest.map((row) => ({ ...row, color: theme.textMuted })),
  ];
}

/** Resolves `assignEntitySlots` against a theme. Overflow entities fall back to the muted token. */
export function resolveEntityColors(names, theme, pinned = {}) {
  const slots = assignEntitySlots(names, pinned);
  const colors = new Map();

  slots.forEach((slot, key) => {
    colors.set(key, slot === null ? theme.textMuted : theme.series[slot]);
  });

  return colors;
}

function readIsDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/**
 * Recharts needs literal colour values rather than CSS variables, so the theme
 * is resolved in JS and re-resolved whenever the global `dark` class flips.
 */
export function useReportsTheme() {
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const observer = new MutationObserver(() => setIsDark(readIsDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return isDark ? DARK_THEME : LIGHT_THEME;
}

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Smoothly counts a KPI value up to its target. Honours reduced-motion by
 * jumping straight to the final value.
 */
export function useCountUp(target, duration = 900, startFromZero = false) {
  const numericTarget = Number.isFinite(Number(target)) ? Number(target) : 0;
  const initialValue = startFromZero ? 0 : numericTarget;
  const [display, setDisplay] = useState(initialValue);
  const fromRef = useRef(initialValue);
  const frameRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      fromRef.current = numericTarget;
      setDisplay(numericTarget);
      return undefined;
    }

    const from = fromRef.current;
    const delta = numericTarget - from;

    if (delta === 0) {
      return undefined;
    }

    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;

      setDisplay(next);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = numericTarget;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frameRef.current);
  }, [duration, numericTarget]);

  return display;
}

/** Defers mounting until the element scrolls near the viewport, so off-screen charts stay cheap. */
export function useLazyMount(rootMargin = "220px") {
  const [visible, setVisible] = useState(false);
  const nodeRef = useRef(null);

  const setNode = useCallback((node) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    const node = nodeRef.current;

    if (!node || visible) {
      return undefined;
    }

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [rootMargin, visible]);

  return [setNode, visible];
}

const decimalFormatter = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatNumber(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

export function formatDecimal(value) {
  return decimalFormatter.format(Number(value) || 0);
}

export function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

/** Axis-friendly short form: 1.2K / 3.4M. Values keep full precision in tooltips and the table. */
export function formatCompact(value) {
  const amount = Number(value) || 0;
  const absolute = Math.abs(amount);

  if (absolute >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  }

  if (absolute >= 1_000) {
    return `${(amount / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
  }

  return numberFormatter.format(Math.round(amount));
}

export function formatCompactCurrency(value) {
  return `₱${formatCompact(value)}`;
}

export function formatKpiValue(value, format) {
  if (format === "currency") {
    return formatCurrency(value);
  }

  if (format === "decimal") {
    return formatDecimal(value);
  }

  return formatNumber(value);
}

/**
 * Month-over-month delta. Returns null when there is no comparable baseline so
 * the card can stay silent instead of showing a fabricated "+100%".
 */
export function computeDelta(value, previous) {
  if (previous === null || previous === undefined) {
    return null;
  }

  const current = Number(value) || 0;
  const base = Number(previous) || 0;

  if (base === 0) {
    return current === 0 ? { percent: 0, direction: "flat", absolute: 0 } : null;
  }

  const change = ((current - base) / Math.abs(base)) * 100;

  return {
    percent: change,
    absolute: current - base,
    direction: change > 0.05 ? "up" : change < -0.05 ? "down" : "flat",
  };
}

export const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "last90", label: "Last 90 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "thisYear", label: "This Year" },
  { value: "lastYear", label: "Last Year" },
  { value: "alltime", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

export function localDateString(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
