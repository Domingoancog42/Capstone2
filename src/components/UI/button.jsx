import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const variantClasses = {
  primary: "app-button--primary",
  secondary: "app-button--secondary",
  success: "app-button--success",
  ghost: "app-button--ghost",
  // Destructive actions deliberately keep their warning color instead of inheriting the system
  // accent; changing a theme must not make an archive or delete action look routine.
  danger: "app-button--danger",
  icon: "app-button--secondary px-0",
};

const sizeClasses = {
  md: "min-h-9 px-3.5 text-sm",
  sm: "min-h-8 px-2.5 text-xs",
};

function isFontAwesomeIcon(icon) {
  return Array.isArray(icon) || (icon && typeof icon === "object" && icon.prefix && icon.iconName);
}

function ButtonIcon({ icon }) {
  if (isFontAwesomeIcon(icon)) {
    return <FontAwesomeIcon icon={icon} className="text-[15px]" aria-hidden="true" />;
  }

  const Icon = icon;
  return <Icon size={15} aria-hidden="true" />;
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
    "app-button inline-flex items-center justify-center gap-2 rounded-lg border font-semibold leading-none transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70",
    variantClasses[variant] || variantClasses.primary,
    sizeClasses[size] || sizeClasses.md,
    fullWidth ? "w-full" : "",
    variant === "icon" ? "w-9" : "",
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

