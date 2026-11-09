const UI_THEME_STORAGE_KEY = "hris_ui_theme_color";

export const DEFAULT_UI_THEME_COLOR = "#D61E1E";

export const UI_THEME_PRESETS = [
  { name: "Crimson", value: "#D61E1E" },
  { name: "Ocean", value: "#2563EB" },
  { name: "Emerald", value: "#059669" },
  { name: "Violet", value: "#7C3AED" },
  { name: "Amber", value: "#D97706" },
];

export function isUiThemeColor(value) {
  const color = String(value || "").trim();

  return /^#([\da-f]{3}|[\da-f]{6})$/i.test(color);
}

export function normalizeUiThemeColor(value, fallback = DEFAULT_UI_THEME_COLOR) {
  const color = String(value || "").trim();
  const expanded = /^#([\da-f]{3})$/i.exec(color);

  if (expanded) {
    return `#${expanded[1].split("").map((part) => part + part).join("").toUpperCase()}`;
  }

  return /^#[\da-f]{6}$/i.test(color) ? color.toUpperCase() : fallback;
}

function hexToRgb(color) {
  const normalized = normalizeUiThemeColor(color);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function mixColors(color, target, amount) {
  const sourceRgb = hexToRgb(color);
  const targetRgb = hexToRgb(target);
  const mix = (source, destination) => Math.round(source + (destination - source) * amount);
  const toHex = (value) => value.toString(16).padStart(2, "0");

  return `#${toHex(mix(sourceRgb.r, targetRgb.r))}${toHex(mix(sourceRgb.g, targetRgb.g))}${toHex(mix(sourceRgb.b, targetRgb.b))}`.toUpperCase();
}

/*
 * The `accent` Tailwind scale (tailwind.config.js) as "r g b" triplets, so its classes keep their
 * opacity modifiers. Lighter shades mix toward white and darker ones toward black, around the
 * selected color itself at 600. The defaults for the stock crimson sit in tailwind.css.
 */
const ACCENT_SCALE = [
  [50, "#FFFFFF", 0.92],
  [100, "#FFFFFF", 0.84],
  [200, "#FFFFFF", 0.68],
  [300, "#FFFFFF", 0.5],
  [400, "#FFFFFF", 0.26],
  [500, "#FFFFFF", 0.12],
  [600, "#000000", 0],
  [700, "#000000", 0.16],
  [800, "#000000", 0.34],
  [900, "#000000", 0.48],
  [950, "#000000", 0.62],
];

function contrastText(color) {
  const { r, g, b } = hexToRgb(color);
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;

  return darkContrast > whiteContrast ? "#1F2937" : "#FFFFFF";
}

/**
 * Paints the global visual tokens only. No routing, permissions, form data, or module behaviour
 * is touched, so the color can be changed safely while a workspace is open.
 */
export function applyUiThemeColor(value, { persist = true } = {}) {
  if (typeof document === "undefined") {
    return DEFAULT_UI_THEME_COLOR;
  }

  const color = normalizeUiThemeColor(value);
  const root = document.documentElement;
  const rgb = hexToRgb(color);

  root.dataset.uiThemeColor = color.slice(1).toLowerCase();
  root.style.setProperty("--ui-accent", color);
  root.style.setProperty("--ui-accent-hover", mixColors(color, "#000000", 0.16));
  root.style.setProperty("--ui-accent-deep", mixColors(color, "#000000", 0.34));
  root.style.setProperty("--ui-accent-tint", mixColors(color, "#FFFFFF", 0.92));
  root.style.setProperty("--ui-accent-soft", mixColors(color, "#FFFFFF", 0.82));
  root.style.setProperty("--ui-accent-border", mixColors(color, "#FFFFFF", 0.68));
  root.style.setProperty("--ui-accent-border-hover", mixColors(color, "#FFFFFF", 0.5));
  root.style.setProperty("--ui-accent-on-dark", mixColors(color, "#FFFFFF", 0.3));
  root.style.setProperty("--ui-accent-soft-on-dark", mixColors(color, "#FFFFFF", 0.5));
  root.style.setProperty("--ui-accent-rgb", `${rgb.r} ${rgb.g} ${rgb.b}`);
  root.style.setProperty("--ui-on-accent", contrastText(color));
  root.style.setProperty("--ui-surface-top", mixColors(color, "#FFFFFF", 0.97));
  root.style.setProperty("--ui-surface", mixColors(color, "#FFFFFF", 0.93));
  root.style.setProperty("--ui-surface-bottom", mixColors(color, "#FFFFFF", 0.86));
  // Older modules use the shared brand scale rather than the newer UI tokens. Updating both
  // keeps their cards, controls, and sidebar states in the same selected color family.
  root.style.setProperty("--brand", color);
  root.style.setProperty("--brand-hover", mixColors(color, "#000000", 0.16));
  root.style.setProperty("--brand-deep", mixColors(color, "#000000", 0.34));
  root.style.setProperty("--brand-tint", mixColors(color, "#FFFFFF", 0.92));
  root.style.setProperty("--brand-border", mixColors(color, "#FFFFFF", 0.68));
  root.style.setProperty("--brand-border-hover", mixColors(color, "#FFFFFF", 0.5));
  root.style.setProperty("--brand-50", mixColors(color, "#FFFFFF", 0.92));
  root.style.setProperty("--brand-100", mixColors(color, "#FFFFFF", 0.84));
  root.style.setProperty("--brand-200", mixColors(color, "#FFFFFF", 0.68));
  root.style.setProperty("--brand-300", mixColors(color, "#FFFFFF", 0.5));
  root.style.setProperty("--brand-400", mixColors(color, "#FFFFFF", 0.26));
  root.style.setProperty("--brand-500", mixColors(color, "#000000", 0.06));
  root.style.setProperty("--brand-600", color);
  root.style.setProperty("--brand-700", mixColors(color, "#000000", 0.16));
  root.style.setProperty("--brand-800", mixColors(color, "#000000", 0.34));
  root.style.setProperty("--brand-950", mixColors(color, "#000000", 0.62));
  root.style.setProperty("--surface-top", mixColors(color, "#FFFFFF", 0.97));
  root.style.setProperty("--surface", mixColors(color, "#FFFFFF", 0.93));
  root.style.setProperty("--surface-bottom", mixColors(color, "#FFFFFF", 0.86));
  ACCENT_SCALE.forEach(([shade, target, amount]) => {
    const shadeRgb = hexToRgb(mixColors(color, target, amount));
    root.style.setProperty(`--accent-${shade}-rgb`, `${shadeRgb.r} ${shadeRgb.g} ${shadeRgb.b}`);
  });

  if (persist && typeof window !== "undefined") {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, color);
  }

  return color;
}

export function getStoredUiThemeColor() {
  if (typeof window === "undefined") {
    return DEFAULT_UI_THEME_COLOR;
  }

  return normalizeUiThemeColor(window.localStorage.getItem(UI_THEME_STORAGE_KEY));
}

/**
 * The color painted on the page right now, which is not always the stored one: Settings >
 * Preferences previews a pick with `persist: false` so it can be abandoned by reloading.
 *
 * Screens that re-sync the shared color compare this with getStoredUiThemeColor() to tell an
 * unsaved preview apart from a tab that has simply not seen another administrator's save yet, so
 * re-syncing never wipes a color the administrator is still deciding on.
 */
export function getActiveUiThemeColor() {
  if (typeof document === "undefined") {
    return DEFAULT_UI_THEME_COLOR;
  }

  const applied = document.documentElement.style.getPropertyValue("--ui-accent");

  return isUiThemeColor(applied) ? normalizeUiThemeColor(applied) : getStoredUiThemeColor();
}

export function initializeUiTheme() {
  return applyUiThemeColor(getStoredUiThemeColor(), { persist: false });
}
