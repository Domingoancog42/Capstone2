import React from "react";
import { Palette, RotateCcw, Save } from "lucide-react";
import Button from "../../components/UI/button";
import { SettingsPanel } from "../../components/settings";
import {
  DEFAULT_UI_THEME_COLOR,
  normalizeUiThemeColor,
  UI_THEME_PRESETS,
} from "../../components/theme/systemTheme";

export default function PreferencesSettings({ color, notice, noticeTone, saving, onColorChange, onSave }) {
  const selectedColor = normalizeUiThemeColor(color);

  return (
    <SettingsPanel
      icon={Palette}
      title="Interface color"
      description="Choose the shared accent color for cards, sidebars, buttons, links, and visual highlights throughout every module. This only changes the interface."
      notice={notice}
      noticeTone={noticeTone}
      onSubmit={onSave}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            icon={RotateCcw}
            disabled={saving || selectedColor === DEFAULT_UI_THEME_COLOR}
            onClick={() => onColorChange(DEFAULT_UI_THEME_COLOR)}
          >
            Restore Default
          </Button>
          <Button type="submit" icon={Save} loading={saving}>
            Save Preference
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_250px]">
        <div>
          <p className="m-0 text-sm font-semibold text-slate-800">Color palette</p>
          <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
            Pick a preset or use the color picker for a custom brand color. The preview updates immediately; save to share it across the system.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {UI_THEME_PRESETS.map((preset) => {
              const selected = preset.value === selectedColor;

              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onColorChange(preset.value)}
                  className={`rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[color:var(--ui-accent)]/25 ${
                    selected
                      ? "border-[color:var(--ui-accent)] bg-[color:var(--ui-accent-tint)] shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="block h-8 w-full rounded-lg shadow-inner"
                    style={{ backgroundColor: preset.value }}
                    aria-hidden="true"
                  />
                  <span className="mt-2 block text-xs font-semibold text-slate-800">{preset.name}</span>
                </button>
              );
            })}
          </div>

          <label className="mt-5 flex max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700">
            <span
              className="h-8 w-8 shrink-0 rounded-lg border border-black/10"
              style={{ backgroundColor: selectedColor }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">Custom color</span>
            <input
              type="color"
              value={selectedColor}
              aria-label="Custom interface color"
              onChange={(event) => onColorChange(event.target.value)}
              className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <output className="font-mono text-xs text-slate-500">{selectedColor}</output>
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[color:var(--ui-accent-border)] bg-white shadow-sm">
          <div className="flex h-28 items-end bg-[color:var(--ui-accent)] p-3">
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[color:var(--ui-on-accent)]">Sidebar</span>
          </div>
          <div className="p-4">
            <p className="m-0 text-sm font-bold text-[color:var(--ui-accent)]">Card preview</p>
            <p className="m-0 mt-1 text-xs leading-5 text-slate-500">Shared interface accent</p>
            <span className="mt-3 inline-flex rounded-lg bg-[color:var(--ui-accent)] px-3 py-2 text-xs font-bold text-[color:var(--ui-on-accent)]">
              Primary button
            </span>
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}
