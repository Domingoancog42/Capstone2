import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeTheme } from "./components/darkmode/darkmodetoggle";
import { initializeUiTheme } from "./components/theme/systemTheme";
import "./tailwind.css";
// After tailwind.css: the mobile layer overrides utilities at equal specificity, so it must win on order.
import "./mobile.css";

// Theme is a device preference, not a session preference. Keep it active on authentication screens
// and through sign-out so the whole experience stays visually consistent.
initializeTheme();

// Use the last known system accent immediately, then App refreshes it from the shared setting.
// This avoids a flash back to crimson while the public settings request is in flight.
initializeUiTheme();

const root = createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
