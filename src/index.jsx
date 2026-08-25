import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, initializeTheme } from "./components/darkmode/darkmodetoggle";
import { initializeUiTheme } from "./components/theme/systemTheme";
import { readStoredUser } from "./utils/roleRoutes";
import "./tailwind.css";
// After tailwind.css: the mobile layer overrides utilities at equal specificity, so it must win on order.
import "./mobile.css";

if (readStoredUser()) {
  initializeTheme();
} else {
  applyTheme("light");
}

// Use the last known system accent immediately, then App refreshes it from the shared setting.
// This avoids a flash back to crimson while the public settings request is in flight.
initializeUiTheme();

const root = createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
