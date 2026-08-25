import React, { useEffect, useState } from "react";
import { Check, ChevronRight, Contrast, Moon, Sun } from "lucide-react";

const THEME_STORAGE_KEY = "hris_theme";

export function getStoredTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" ? "dark" : "light";
}

export function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function initializeTheme() {
  applyTheme(getStoredTheme());
}

export function isDarkThemeEnabled() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function ThemeToggleButton({ className = "" }) {
  const [theme, setTheme] = useState(getStoredTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      className={`grid h-10 w-10 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-slate-300 hover:bg-white ${className}`.trim()}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export default function DarkModeToggle({ collapsed = false, variant = "default" }) {
  const [theme, setTheme] = useState(getStoredTheme);
  const isCrimson = variant === "crimson";

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const options = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div className="group relative mb-3">
      <button
        type="button"
        title="Theme"
        aria-label="Theme"
        className={`flex min-h-11 w-full transform-gpu items-center gap-3 rounded-2xl text-sm font-medium transition duration-200 ease-out hover:translate-x-1 hover:shadow-sm active:scale-[0.98] ${
          isCrimson
            ? "text-white hover:bg-white/10 hover:text-white"
            : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
        } ${
          collapsed ? "justify-center px-0" : "justify-between px-3.5"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Contrast size={18} className={`shrink-0 ${isCrimson ? "text-white" : "text-slate-900"}`} />
          <span className={`truncate ${collapsed ? "hidden" : ""}`}>Theme</span>
        </span>
        {collapsed ? null : <ChevronRight size={16} className={`shrink-0 ${isCrimson ? "text-red-100" : "text-slate-500"}`} />}
      </button>

      <div className="invisible absolute bottom-0 left-full z-50 w-72 translate-x-1 pl-2 opacity-0 transition duration-150 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-x-0 group-focus-within:opacity-100">
        <div className="rounded-xl border border-slate-200 bg-white py-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
          {options.map((option) => {
            const Icon = option.icon;
            const active = theme === option.key;

            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setTheme(option.key)}
                className="flex min-h-10 w-full items-center justify-between gap-3 px-4 text-left text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon size={18} className="shrink-0 text-slate-950" />
                  <span className="truncate">{option.label}</span>
                </span>
                {active ? <Check size={17} className="shrink-0 text-slate-700" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

