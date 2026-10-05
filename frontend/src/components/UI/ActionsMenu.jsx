import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EllipsisVertical } from "lucide-react";

const MENU_WIDTH = 208;
const VIEWPORT_GAP = 8;

function getMenuPosition(trigger, menu) {
  const triggerRect = trigger.getBoundingClientRect();
  const menuHeight = menu?.offsetHeight || 0;
  const availableBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_GAP;
  const openAbove = menuHeight > availableBelow && triggerRect.top > availableBelow;
  const top = openAbove
    ? Math.max(VIEWPORT_GAP, triggerRect.top - menuHeight - 4)
    : Math.max(
        VIEWPORT_GAP,
        Math.min(window.innerHeight - menuHeight - VIEWPORT_GAP, triggerRect.bottom + 4),
      );
  const left = Math.min(
    window.innerWidth - MENU_WIDTH - VIEWPORT_GAP,
    Math.max(VIEWPORT_GAP, triggerRect.right - MENU_WIDTH),
  );

  return { left, top };
}

/** Compact row-actions dropdown shared by record tables and mobile record cards. */
export default function ActionsMenu({
  children,
  label = "Show actions",
  className = "",
  icon: TriggerIcon = EllipsisVertical,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const updatePosition = useCallback(() => {
    if (triggerRef.current && menuRef.current) {
      setPosition(getMenuPosition(triggerRef.current, menuRef.current));
    }
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOnViewportChange = () => setOpen(false);

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <div className={`inline-flex justify-center ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-grid h-9 w-9 place-items-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      >
        <TriggerIcon size={18} aria-hidden="true" />
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              inert={!open}
              className={`row-actions-menu-content fixed z-[10000] grid gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-xl transition ${
                open ? "visible opacity-100" : "invisible pointer-events-none opacity-0"
              }`}
              style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
              onClickCapture={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
