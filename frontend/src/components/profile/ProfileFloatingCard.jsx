import React, { useEffect, useId } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2, X } from "lucide-react";

/**
 * The floating panel used by the profile page for Salary Grade History and Email & Verification.
 *
 * It deliberately mirrors the auth `AuthCard` shell (accent bar, round icon badge, centred heading)
 * so a signed-in user meets the same card they already saw on the forgot-password screen.
 *
 * A caller that passes `onToggleMaximize` gets a maximize / restore button beside the close button:
 * `maximized` swaps the floating card for one that fills the viewport, which is what a wall of
 * cards (the leave balances) needs and a short form does not. On a phone the card already fills
 * the screen, so the toggle only shows from the `sm` breakpoint up.
 */
export default function ProfileFloatingCard({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  badge: Badge,
  maxWidth = "max-w-[520px]",
  bodyClassName = "px-4 pb-5 sm:px-4",
  closeLabel = "Close",
  maximized = false,
  onToggleMaximize,
  children,
}) {
  const headingId = useId();
  const MaximizeIcon = maximized ? Minimize2 : Maximize2;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    // Locking the page keeps the card from scrolling the profile document behind it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="profile-floating-card fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <motion.button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 border-0 bg-slate-950/55 backdrop-blur-[2px]"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={`relative z-10 flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden border-0 bg-white shadow-[0_30px_80px_rgba(2,6,23,0.45)] sm:my-auto sm:rounded-2xl sm:border sm:border-white/70 ${
              maximized
                ? "sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-none"
                : `sm:h-auto sm:max-h-[94dvh] ${maxWidth}`
            }`.trim()}
          >
            <div className="h-1 shrink-0 bg-gradient-to-r from-[#D61E1E] via-[#d13a3a] to-[#D61E1E]" />

            <div className="absolute right-3.5 top-4 z-10 flex items-center gap-2">
              {onToggleMaximize ? (
                <button
                  type="button"
                  onClick={onToggleMaximize}
                  aria-label={maximized ? "Restore size" : "Maximize"}
                  aria-pressed={maximized}
                  className="hidden h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20 sm:grid"
                >
                  <MaximizeIcon size={15} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E] focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <header className="shrink-0 px-3 pb-3 pt-4 text-center sm:px-4 sm:pb-4 sm:pt-5">
                {Icon ? (
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-[#D61E1E] shadow-inner">
                    <div className="relative grid h-10 w-10 place-items-center rounded-lg bg-white shadow-sm">
                      <Icon size={21} aria-hidden="true" />
                      {Badge ? (
                        <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[#D61E1E] text-white shadow-md">
                          <Badge size={12} aria-hidden="true" />
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <h2
                  id={headingId}
                  className={`m-0 text-lg font-extrabold leading-tight tracking-tight text-slate-950 sm:text-xl ${Icon ? "mt-3" : ""}`.trim()}
                >
                  {title}
                </h2>

                {subtitle ? (
                  <p className="m-0 mx-auto mt-1.5 max-w-[52ch] text-sm font-medium leading-6 text-slate-500">
                    {subtitle}
                  </p>
                ) : null}
              </header>

              <div className={bodyClassName}>{children}</div>
            </div>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
