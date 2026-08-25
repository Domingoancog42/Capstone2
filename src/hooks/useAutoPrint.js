import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Print a form modal as soon as it has finished loading, for callers that opened it only to print.
 *
 * The print window is a clone of what is on screen, so firing it while the signatures and lookups
 * are still in flight would put an unsigned sheet in front of the printer. Every async load the
 * modal starts is registered through the returned `trackLoad`, and the print runs on the first
 * animation frame after the last of them settles — once per open.
 *
 * The count is read inside the frame callback rather than in the effect body, so it does not matter
 * whether this hook is called before or after the effects that start the loads: by the time the
 * frame runs, the whole commit has, and every load of that pass is registered.
 */
export default function useAutoPrint({ active = false, onPrint, onDone }) {
  const pendingLoadsRef = useRef(0);
  const printedRef = useRef(false);
  const onPrintRef = useRef(onPrint);
  const onDoneRef = useRef(onDone);
  const [settledCount, setSettledCount] = useState(0);

  useEffect(() => {
    onPrintRef.current = onPrint;
    onDoneRef.current = onDone;
  }, [onDone, onPrint]);

  const trackLoad = useCallback(async (load) => {
    pendingLoadsRef.current += 1;

    try {
      return await load();
    } finally {
      pendingLoadsRef.current -= 1;

      if (pendingLoadsRef.current === 0) {
        setSettledCount((count) => count + 1);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      printedRef.current = false;
    }
  }, [active]);

  useEffect(() => {
    if (!active || printedRef.current) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      /* Still loading — the load that settles last bumps `settledCount` and brings us back here. */
      if (pendingLoadsRef.current > 0) {
        return;
      }

      printedRef.current = true;
      onPrintRef.current?.();
      onDoneRef.current?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [active, settledCount]);

  return trackLoad;
}
