import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { decorateRequiredFieldLabel } from "./RequiredFieldLabel";

const MENU_MAX_HEIGHT = 320;
const VIEWPORT_PADDING = 8;

function optionValueOf(option) {
  return String((typeof option === "string" ? option : option?.value) ?? "").trim();
}

function optionGroupOf(option) {
  return typeof option === "string" ? "" : String(option?.group || "").trim();
}

const compareText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * A text box with a list to pick from: whatever is typed is kept as typed, and picking an entry fills
 * the box with it. Meant for values that have usual answers but no fixed catalog, such as an
 * employee's designation.
 *
 * `options` are strings or `{ value, group }`. Entries are listed under their `group` heading with
 * `preferredGroup` first; typing narrows the list, and a typed value the list does not have yet is
 * offered as its own last row so it is clear it will be kept. The menu is portalled to the viewport, as in
 * FloatingSelect, so a scrolling modal body cannot clip it.
 */
export default function ComboboxField({
  id,
  name,
  label,
  value = "",
  onChange,
  options = [],
  preferredGroup = "",
  placeholder = "Select or type",
  emptyOptionLabel = "None",
  otherGroupLabel = "Other",
  maxLength,
  error = "",
  disabled = false,
  className = "",
}) {
  const generatedId = useId();
  const inputId = id || name || generatedId;
  const listboxId = `${inputId}-listbox`;
  const fieldRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  // What has been typed since the list opened. Empty lists everything, so opening the list on a
  // filled box still offers the alternatives rather than only the current value.
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState(null);

  const text = String(value ?? "");
  const typed = query.trim();
  const preferred = String(preferredGroup || "").trim().toLowerCase();

  const showGroupHeadings = useMemo(() => options.some((option) => optionGroupOf(option)), [options]);

  // The rows that can be picked, in display order. Group headings are drawn between them, not counted.
  const rows = useMemo(() => {
    const search = typed.toLowerCase();
    const groups = new Map();

    options.forEach((option) => {
      const optionValue = optionValueOf(option);
      const group = optionGroupOf(option);

      if (!optionValue || (search && !optionValue.toLowerCase().includes(search))) {
        return;
      }

      if (!groups.has(group)) {
        groups.set(group, new Map());
      }

      groups.get(group).set(optionValue.toLowerCase(), optionValue);
    });

    const rank = (group) => (group && group.toLowerCase() === preferred ? 0 : group ? 1 : 2);
    const optionRows = [...groups.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || compareText(a, b))
      .flatMap(([group, values]) => [...values.values()]
        .sort(compareText)
        .map((optionValue) => ({ kind: "option", value: optionValue, group })));
    const isListed = options.some((option) => optionValueOf(option).toLowerCase() === search);

    // The typed value goes last, so arrowing down from the box reaches a listed match first.
    return [
      ...(!typed ? [{ kind: "empty", value: "" }] : []),
      ...optionRows,
      ...(typed && !isListed ? [{ kind: "typed", value: typed }] : []),
    ];
  }, [options, preferred, typed]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const openMenu = () => {
    if (disabled) {
      return;
    }

    setQuery("");
    setActiveIndex(-1);
    setIsOpen(true);
  };

  const choose = (row) => {
    onChange?.(row.kind === "empty" ? "" : row.value);
    closeMenu();
  };

  const updateMenuPosition = useCallback(() => {
    const bounds = fieldRef.current?.getBoundingClientRect();

    if (!bounds) {
      return;
    }

    const width = Math.min(bounds.width, window.innerWidth - VIEWPORT_PADDING * 2);
    const left = Math.min(Math.max(bounds.left, VIEWPORT_PADDING), window.innerWidth - width - VIEWPORT_PADDING);
    const spaceBelow = window.innerHeight - bounds.bottom - VIEWPORT_PADDING * 2;
    const spaceAbove = bounds.top - VIEWPORT_PADDING * 2;
    // Only open upward when the box sits low on the screen and there is more room above it.
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;

    setMenuPosition({
      left,
      width,
      top: openUpward ? undefined : bounds.bottom + VIEWPORT_PADDING,
      bottom: openUpward ? window.innerHeight - bounds.top + VIEWPORT_PADDING : undefined,
      maxHeight: Math.max(120, Math.min(MENU_MAX_HEIGHT, openUpward ? spaceAbove : spaceBelow)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return undefined;
    }

    updateMenuPosition();

    const closeOnOutsidePress = (event) => {
      if (fieldRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) {
        return;
      }

      closeMenu();
    };

    document.addEventListener("mousedown", closeOnOutsidePress);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [closeMenu, isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) {
      return;
    }

    menuRef.current?.querySelector(`[data-row-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const handleChange = (event) => {
    onChange?.(event.target.value);
    setQuery(event.target.value);
    setActiveIndex(-1);
    setIsOpen(true);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        openMenu();
        return;
      }

      if (rows.length > 0) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (
          current < 0
            ? (step > 0 ? 0 : rows.length - 1)
            : (current + step + rows.length) % rows.length
        ));
      }

      return;
    }

    if (event.key === "Enter" && isOpen) {
      // In a form, Enter would submit it; while the list is open it picks from the list instead.
      event.preventDefault();

      if (rows[activeIndex]) {
        choose(rows[activeIndex]);
      } else {
        closeMenu();
      }

      return;
    }

    if (event.key === "Escape" && isOpen) {
      // The surrounding modal closes on Escape too; this press is only meant for the list.
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }

    if (event.key === "Tab") {
      closeMenu();
    }
  };

  const selectedKey = text.trim().toLowerCase();
  let previousGroup = null;

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-[130] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10"
      style={{
        left: menuPosition?.left,
        top: menuPosition?.top,
        bottom: menuPosition?.bottom,
        width: menuPosition?.width,
        visibility: menuPosition ? "visible" : "hidden",
      }}
    >
      <div
        id={listboxId}
        role="listbox"
        aria-label={label || placeholder}
        className="overflow-y-auto overscroll-contain py-1"
        style={{ maxHeight: menuPosition?.maxHeight ?? MENU_MAX_HEIGHT }}
      >
        {rows.map((row, index) => {
          const heading = showGroupHeadings && row.kind === "option" && row.group !== previousGroup
            ? row.group || otherGroupLabel
            : "";
          const isActive = index === activeIndex;
          const isSelected = row.kind === "empty" ? !selectedKey : row.value.toLowerCase() === selectedKey;
          const tone = row.kind === "typed"
            ? "text-teal-700"
            : row.kind === "empty"
              ? "text-slate-400"
              : isSelected
                ? "font-semibold text-teal-800"
                : "text-slate-700";

          if (row.kind === "option") {
            previousGroup = row.group;
          }

          return (
            <React.Fragment key={`${row.kind}:${row.group || ""}:${row.value}`}>
              {heading ? (
                <p role="presentation" className="m-0 px-3.5 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {heading}
                </p>
              ) : null}
              <button
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                data-row-index={index}
                aria-selected={isSelected}
                // Keep the focus in the text box so typing can carry on after the click.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(row)}
                // Hovering sets the active row, and bg-teal-50 is the shade that follows the theme colour
                // (hover:bg-teal-50 would not). flex-nowrap because phones otherwise wrap every flex row.
                className={`flex min-h-10 w-full flex-nowrap items-start gap-2 px-3.5 py-2 text-left text-sm transition ${
                  isActive ? "bg-teal-50" : ""
                } ${tone}`}
              >
                {row.kind === "typed" ? <Plus size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
                <span className="min-w-0 flex-1 break-words">
                  {row.kind === "typed" ? `Use "${row.value}"` : row.kind === "empty" ? emptyOptionLabel : row.value}
                </span>
                {isSelected && row.kind === "option" ? <Check size={15} className="mt-0.5 shrink-0 text-teal-700" aria-hidden="true" /> : null}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={`w-full ${className}`.trim()} data-validation-field>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-slate-700">
          {decorateRequiredFieldLabel(label)}
        </label>
      ) : null}
      <div
        ref={fieldRef}
        className={`relative flex min-h-[40px] flex-nowrap items-center rounded-lg border ${disabled ? "bg-slate-50" : "bg-white"} ${
          error ? "border-rose-600" : "border-slate-200"
        }`}
      >
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={() => {
            if (!isOpen) {
              openMenu();
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className="w-full min-w-0 rounded-lg bg-transparent py-2.5 pl-3 pr-16 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-400"
        />
        <div className="absolute inset-y-0 right-1.5 flex flex-nowrap items-center gap-0.5">
          {text && !disabled ? (
            <button
              type="button"
              aria-label={`Clear ${label || "value"}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange?.("");
                closeMenu();
                inputRef.current?.focus();
              }}
              className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            aria-label={isOpen ? "Hide the list" : "Show the list"}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (isOpen) {
                closeMenu();
                return;
              }

              openMenu();
              inputRef.current?.focus();
            }}
            className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
          >
            <ChevronDown size={16} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {isOpen ? createPortal(menu, document.body) : null}
    </div>
  );
}
