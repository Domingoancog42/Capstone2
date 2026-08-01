import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, initializeTheme } from "./components/darkmode/darkmodetoggle";
import { readStoredUser } from "./utils/roleRoutes";
import "./tailwind.css";

if (readStoredUser()) {
  initializeTheme();
} else {
  applyTheme("light");
}

const root = createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
