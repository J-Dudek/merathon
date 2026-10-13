import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { initTheme } from "./lib/theme";

// Avant le premier rendu : pas de flash du thème sombre quand le thème clair est choisi.
initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
