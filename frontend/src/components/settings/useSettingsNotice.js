import { useCallback, useRef, useState } from "react";

/**
 * Feedback state for one settings section, as `{ tone, text }` plus the setters.
 *
 * Screens used to hold feedback in a bare string, which carried no way to tell a confirmation from
 * a failure — so every message rendered in whatever colour that particular screen happened to use.
 * Pairing the text with its tone at the point it is set keeps the two from drifting apart, and
 * `SettingsNotice` renders the pair consistently.
 *
 *   const notice = useSettingsNotice();
 *   notice.success("Divisions saved.");
 *   notice.error(requestError.response?.data?.message || "Unable to save divisions.");
 *   <SettingsNotice tone={notice.tone}>{notice.text}</SettingsNotice>
 *
 * The returned object keeps a stable identity for the life of the component: the current tone and
 * text are written onto the same container each render rather than a fresh object being built. That
 * matters because these notices are set from `useCallback` handlers — a new object every render
 * would mean either stale-closure bugs or a dependency that invalidates every handler on the page
 * each time a message changes.
 */
export default function useSettingsNotice(initial = null) {
  const [notice, setNotice] = useState(initial);

  const show = useCallback((tone, text) => {
    setNotice(text ? { tone, text } : null);
  }, []);

  const apiRef = useRef(null);

  if (apiRef.current === null) {
    apiRef.current = {
      tone: "info",
      text: "",
      show,
      clear: () => setNotice(null),
      info: (text) => show("info", text),
      success: (text) => show("success", text),
      warning: (text) => show("warning", text),
      error: (text) => show("error", text),
    };
  }

  apiRef.current.tone = notice?.tone || "info";
  apiRef.current.text = notice?.text || "";

  return apiRef.current;
}
