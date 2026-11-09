import React, { useLayoutEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

// Charts in hidden panels and newly mounted grids have no dimensions yet.
// Wait for a real measurement, and observe the wrapper so they also recover
// when a panel becomes visible or the viewport changes.
export default function ResponsiveChartContainer({
  children,
  width = "100%",
  height = "100%",
  minWidth = 0,
  minHeight = 0,
  maxHeight,
  aspect,
  className,
  style,
  onResize,
}) {
  const containerRef = useRef(null);
  const onResizeRef = useRef(onResize);
  const [size, setSize] = useState({ width: 0, height: 0 });
  onResizeRef.current = onResize;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = ({ width: nextWidth, height: nextHeight }) => {
      const measuredWidth = Math.max(0, Math.round(nextWidth));
      const measuredHeight = Math.max(0, Math.round(nextHeight));
      setSize((current) => current.width === measuredWidth && current.height === measuredHeight
        ? current
        : { width: measuredWidth, height: measuredHeight });
      onResizeRef.current?.(measuredWidth, measuredHeight);
    };

    measure(container.getBoundingClientRect());
    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => measure(container.getBoundingClientRect());
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) measure(entries[0].contentRect);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={className}
      ref={containerRef}
      style={{ width, height: aspect ? "auto" : height, minWidth, minHeight, maxHeight, aspectRatio: aspect, ...style }}
    >
      {size.width > 0 && size.height > 0 ? (
        <ResponsiveContainer width={size.width} height={size.height}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
