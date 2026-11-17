import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { isServer } from "./platform";

/** Ouvre une adresse web : dans le navigateur du système (Tauri), ou dans un nouvel onglet quand Merathon est servi par un NAS. */
export function openUrl(url: string): Promise<void> {
  if (isServer()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  }
  return tauriOpenUrl(url);
}
