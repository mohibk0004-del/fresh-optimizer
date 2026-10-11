import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App";
import { applyTheme, loadSettings } from "./lib/theme";

// Paint the saved theme before React mounts, so there is no colour flash.
applyTheme(loadSettings());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Springs collapse to plain fades for users with reduced motion. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
