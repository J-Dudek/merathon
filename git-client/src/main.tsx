// En premier : reprend les réglages de l'ancien nom avant que les stores ne les lisent.
import "./lib/migrateStorage";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ServerGate } from "./components/ServerGate";
import { isServer } from "./lib/platform";
import { confirmLeavingWithTerminal } from "./lib/terminals";
import { initTheme } from "./lib/theme";
import { language } from "./i18n";
import { setBackendLanguage } from "./ipc/commands";

// Servi par un NAS : lien direct vers un dépôt (?repo=…), ouvert sans reprendre ni enregistrer la session, comme une
// fenêtre secondaire du bureau.
if (isServer()) {
  (window as { __MERATHON_OPEN_REPO__?: string | null }).__MERATHON_OPEN_REPO__ = new URLSearchParams(window.location.search).get("repo");
  // Ctrl+W, gardé par le navigateur, fermerait l'onglet et le shell du terminal intégré sans prévenir.
  window.addEventListener("beforeunload", confirmLeavingWithTerminal);
}

// Avant le premier rendu : pas de flash du thème sombre quand le thème clair est choisi.
initTheme();
// Sans backend, comme dans un navigateur : les messages sont seulement ceux du frontend.
setBackendLanguage(language).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ServerGate>
      <App />
    </ServerGate>
  </React.StrictMode>,
);
