import React, { useId } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { AUTH_EYEBROW_CLASS, AUTH_FOCUS_RING, cx } from "./authTheme";

const enter = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
};

/**
 * The white panel every auth screen renders inside: accent bar, optional back button, optional
 * round icon, heading block, body, and footer.
 *
 * Before this component each screen re-declared the same shell classes, its own back button, and
 * its own heading markup — four copies that had already drifted apart in padding and icon size.
 */
export default function AuthCard({
  badge: Badge,
  children,
  className = "",
  eyebrow,
  footer,
  highlight,
  icon: Icon,
  onBack,
  backLabel = "Back to sign in",
  subtitle,
  title,
}) {
  const headingId = useId();

  return (
    <motion.section
      animate="visible"
      aria-labelledby={headingId}
      className={cx(
        "relative w-full overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_30px_80px_rgba(2,6,23,0.45)]",
        className,
      )}
      initial="hidden"
      transition={{ duration: 0.4, ease: "easeOut" }}
      variants={enter}
    >
      <div className="h-1.5 bg-gradient-to-r from-[#D61E1E] via-[#d13a3a] to-[#D61E1E]" />

      <div className="px-6 pb-7 pt-6 sm:px-8 sm:pb-8">
        {onBack ? (
          <button
            aria-label={backLabel}
            className={cx(
              "mb-5 inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:border-[#F8BFBF] hover:bg-[#FEF1F1] hover:text-[#D61E1E]",
              AUTH_FOCUS_RING,
            )}
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <span>Back</span>
          </button>
        ) : null}

        <header className="text-center">
          {Icon ? (
            <div className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-[#D61E1E] shadow-inner">
              <div className="relative grid h-12 w-12 place-items-center rounded-xl bg-white shadow-sm">
                <Icon aria-hidden="true" size={26} />
                {Badge ? (
                  <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-[#D61E1E] text-white shadow-md">
                    <Badge aria-hidden="true" size={14} />
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {eyebrow ? <p className={cx(AUTH_EYEBROW_CLASS, Icon ? "mt-4" : "")}>{eyebrow}</p> : null}

          <h1
            className="m-0 mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-slate-950"
            id={headingId}
          >
            {title}
          </h1>

          {subtitle ? (
            <p className="m-0 mx-auto mt-2 max-w-[38ch] text-sm font-medium leading-6 text-slate-500">
              {subtitle}
            </p>
          ) : null}

          {highlight ? (
            <p className="m-0 mt-1.5 break-all text-sm font-extrabold text-slate-900">{highlight}</p>
          ) : null}
        </header>

        <div className="mt-6">{children}</div>

        {footer ? <div className="mt-6 border-t border-slate-100 pt-4">{footer}</div> : null}
      </div>
    </motion.section>
  );
}
