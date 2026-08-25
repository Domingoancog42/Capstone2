import React from "react";

export default function Card({ children, className = "", as: Component = "section" }) {
  return (
    <Component
      className={`app-card rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors duration-300 ${className}`.trim()}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ children, className = "" }) {
  return (
    <div className={`border-b border-slate-200 p-3.5 transition-colors duration-300 sm:p-4 ${className}`.trim()}>
      {children}
    </div>
  );
}

/**
 * Brand red rather than slate: the title is the one piece of card text that carries the brand. Body
 * copy stays slate — it sits at 17.9:1 on white, where the brand red is 5.2:1, and colouring the
 * dense tables these cards hold would cost real legibility for no gain.
 */
export function CardTitle({ children, className = "" }) {
  return (
    <h2 className={`app-card-title m-0 text-base font-semibold leading-tight text-[#D61E1E] dark:text-slate-100 ${className}`.trim()}>
      {children}
    </h2>
  );
}

export function CardDescription({ children, className = "" }) {
  return <p className={`mt-1.5 text-xs leading-5 text-slate-500 ${className}`.trim()}>{children}</p>;
}

export function CardContent({ children, className = "" }) {
  return <div className={`p-3.5 transition-colors duration-300 sm:p-4 ${className}`.trim()}>{children}</div>;
}

export function CardFooter({ children, className = "" }) {
  return <div className={`p-3.5 transition-colors duration-300 sm:p-4 ${className}`.trim()}>{children}</div>;
}
