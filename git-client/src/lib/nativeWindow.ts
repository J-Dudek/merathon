/**
 * Ce que Tauri fait de la fenêtre (thème de la barre de titre, zoom, version), avec son équivalent dans un navigateur
 * quand Merathon est servi par un NAS.
 */
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isServer } from "./platform";

/** `main` pour la fenêtre principale, qui rouvre les onglets de la session précédente ; un onglet ouvert sur un dépôt n'est pas `main`. */
export function currentWindowLabel(): string {
  if (isServer()) return new URLSearchParams(window.location.search).has("repo") ? "repo" : "main";
  return getCurrentWindow().label;
}

/** Thème des contrôles natifs de la fenêtre ; `null` : celui du système. Sans effet dans un navigateur. */
export async function setWindowTheme(theme: "dark" | "light" | null): Promise<void> {
  if (isServer()) return;
  await getCurrentWindow().setTheme(theme);
}

/**
 * Taille de l'interface : zoom du webview (net, y compris le graphe dessiné en canvas). Dans un navigateur (NAS), c'est
 * le zoom du navigateur, seul : un second zoom de Merathon s'y multiplierait (Ctrl+= y est laissé au navigateur).
 */
export async function setViewZoom(zoom: number): Promise<void> {
  if (isServer()) return;
  await getCurrentWebview().setZoom(zoom);
}

/** Version de l'application installée (Tauri), ou du serveur (voir `serverInfo`). */
export async function appVersion(serverVersion: () => Promise<string>): Promise<string> {
  return isServer() ? serverVersion() : getVersion();
}
