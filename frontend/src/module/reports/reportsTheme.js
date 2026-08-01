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
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  deltaUp: "#0ca30c",
  deltaDown: "#e66767",
};

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
export function useCountUp(target, duration = 900) {
  const numericTarget = Number.isFinite(Number(target)) ? Number(target) : 0;
  const [display, setDisplay] = useState(numericTarget);
  const fromRef = useRef(numericTarget);
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
