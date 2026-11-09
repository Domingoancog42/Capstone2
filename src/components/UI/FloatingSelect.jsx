import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

const OPTION_HEIGHT = 40;
const DEFAULT_VISIBLE_OPTION_COUNT = 8;

/**
 * A select-like control whose menu is portalled to the viewport. This keeps long option lists out
 * of modal layout flow and prevents a scrolling modal body from clipping the menu.
 */
export default function FloatingSelect({
  id,
  ariaLabel,
  value = "",
  options = [],
  placeholder = "Select an option",
  visibleThrough = "",
  onChange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const menuOptions = useMemo(
    () => [{ value: "", label: placeholder, isPlaceholder: true }, ...options.map((option) => (
      typeof option === "string" ? { value: option, label: option } : option
    ))],
    [options, placeholder]
  );
  const selectedOption = menuOptions.find((option) => option.value === value) || menuOptions[0];
  const visibleOptionCount = useMemo(() => {
    const boundaryIndex = menuOptions.findIndex(
      (option) => option.label.toLowerCase() === String(visibleThrough).trim().toLowerCase()
    );

    return boundaryIndex >= 0 ? boundaryIndex + 1 : DEFAULT_VISIBLE_OPTION_COUNT;
  }, [menuOptions, visibleThrough]);
  const menuMaxHeight = visibleOptionCount * OPTION_HEIGHT;

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) {
      return;
    }

    const triggerBounds = triggerRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.min(
      Math.max(triggerBounds.width, 220),
      window.innerWidth - viewportPadding * 2
    );
    const left = Math.min(
      Math.max(triggerBounds.left, viewportPadding),
      window.innerWidth - width - viewportPadding
    );
    const top = triggerBounds.bottom + 8;

    setMenuPosition({
      left,
      top,
      width,
      maxHeight: Math.min(menuMaxHeight, Math.max(120, window.innerHeight - top - viewportPadding)),
    });
  }, [menuMaxHeight]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return undefined;
    }

    updateMenuPosition();

    const closeOnOutsideClick = (event) => {
      if (
        triggerRef.current?.contains(event.target)
        || menuRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const selectOption = (optionValue) => {
    onChange?.(optionValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const menu = !isOpen ? null : (
    <div
      ref={menuRef}
      className="fixed z-[130] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10"
      style={{
        left: menuPosition?.left,
        top: menuPosition?.top,
        width: menuPosition?.width,
        visibility: menuPosition ? "visible" : "hidden",
      }}
    >
      <div
        role="listbox"
        aria-label={ariaLabel}
        className="overflow-y-auto overscroll-contain"
        style={{ maxHeight: menuPosition?.maxHeight ?? menuMaxHeight }}
      >
        {menuOptions.map((option) => {
          const selected = option.value === value;

          return (
            <button
              key={option.value || "__placeholder__"}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => selectOption(option.value)}
              className={`flex h-10 w-full items-center gap-2 px-3.5 text-left text-sm transition hover:bg-teal-50 focus:bg-teal-50 focus:outline-none ${
                option.isPlaceholder ? "text-slate-400" : "text-slate-700"
              } ${selected ? "bg-teal-50 font-semibold text-teal-800" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {selected ? <Check size={15} className="shrink-0 text-teal-700" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-[46px] w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm outline-none transition hover:border-slate-300 focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
      >
        <span className={`min-w-0 flex-1 truncate ${value ? "text-slate-900" : "text-slate-400"}`}>
          {selectedOption.label}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? createPortal(menu, document.body) : null}
    </>
  );
}
