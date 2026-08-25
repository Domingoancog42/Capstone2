import React, { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Button from "./button";

export default function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  closeLabel = "Close",
  maxWidth = "max-w-[520px]",
  maxHeight = "max-h-[92dvh]",
  panelClassName = "",
  contentClassName = "",
  headerClassName = "",
  footerClassName = "",
  backdropClassName = "",
  containerClassName = "",
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <div className={`fixed inset-0 z-50 grid place-items-center p-3 sm:p-5 ${containerClassName}`.trim()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={`fixed inset-0 border-0 bg-slate-900/50 dark:bg-slate-950/80 ${backdropClassName}`.trim()}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          />
          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`app-modal-panel relative z-10 flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${maxWidth} ${maxHeight} ${panelClassName}`.trim()}
          >
            <div className={`flex items-center justify-between gap-3 border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-700 sm:px-4 sm:py-3 ${headerClassName}`.trim()}>
              <h2 id="modal-title" className="m-0 text-sm font-semibold text-slate-900 dark:text-slate-100 sm:text-base">
                {title}
              </h2>
              <Button variant="icon" size="sm" icon={X} onClick={onClose} aria-label={closeLabel} />
            </div>
            <div className={`app-modal-content overflow-y-auto px-3.5 py-3.5 text-sm text-slate-600 dark:text-slate-300 sm:px-4 sm:py-4 ${contentClassName}`.trim()}>{children}</div>
            {footer ? <div className={`app-modal-footer flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 px-3.5 py-2.5 dark:border-slate-700 sm:px-4 sm:py-3 ${footerClassName}`.trim()}>{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
