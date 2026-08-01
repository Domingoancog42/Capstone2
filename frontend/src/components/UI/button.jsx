import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const variantClasses = {
  primary:
    "border-[#D61E1E] bg-[#D61E1E] text-white hover:border-[#B41818] hover:bg-[#B41818] dark:border-[#21c45d] dark:bg-[#21c45d] dark:hover:border-[#18a84c] dark:hover:bg-[#18a84c]",
  secondary:
    "border-[#F8BFBF] bg-white text-[#D61E1E] hover:border-[#F18E8E] hover:bg-[#FEF1F1] dark:border-[#14532d] dark:bg-[#0f172a] dark:text-[#bbf7d0] dark:hover:border-[#21c45d] dark:hover:bg-[#13221a]",
  ghost: "border-transparent bg-transparent text-[#D61E1E] hover:bg-[#FEF1F1] dark:text-[#21c45d] dark:hover:bg-[#21c45d]/10",
  danger: "border-[#D61E1E] bg-[#D61E1E] text-white hover:border-[#B41818] hover:bg-[#B41818]",
  icon:
    "border-[#F8BFBF] bg-white text-[#D61E1E] hover:border-[#F18E8E] hover:bg-[#FEF1F1] dark:border-[#14532d] dark:bg-[#0f172a] dark:text-[#21c45d] dark:hover:border-[#21c45d] dark:hover:bg-[#13221a] px-0",
};

const sizeClasses = {
  md: "min-h-[42px] px-4 text-base",
  sm: "min-h-9 px-3 text-sm",
};

function isFontAwesomeIcon(icon) {
  return Array.isArray(icon) || (icon && typeof icon === "object" && icon.prefix && icon.iconName);
}

function ButtonIcon({ icon }) {
  if (isFontAwesomeIcon(icon)) {
    return <FontAwesomeIcon icon={icon} className="text-[18px]" aria-hidden="true" />;
  }

  const Icon = icon;
  return <Icon size={18} aria-hidden="true" />;
}

export default function Button({
  children,
  type = "button",
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  ...props
}) {
  const classes = [
    "inline-flex items-center justify-center gap-2 rounded-lg border font-semibold leading-none transition focus:outline-none focus:ring-2 focus:ring-[#D61E1E]/20 dark:focus:ring-[#21c45d]/20 disabled:cursor-not-allowed disabled:opacity-70",
    variantClasses[variant] || variantClasses.primary,
    sizeClasses[size] || sizeClasses.md,
    fullWidth ? "w-full" : "",
    variant === "icon" ? "w-[38px]" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...props}>
      {loading ? <span aria-hidden="true">...</span> : null}
      {!loading && icon ? <ButtonIcon icon={icon} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

