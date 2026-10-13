import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDisplayStore, type ThemePreference } from "../store/useDisplayStore";

export type Theme = "dark" | "light";

/** Thème affiché : celui choisi, ou celui du système pour « system ». */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference !== "system") return preference;
  return systemDark ? "dark" : "light";
}

/** Thème affiché, pour ce qui est dessiné hors CSS (graphe en canvas, terminal). */
export const useThemeStore = create<{ theme: Theme }>(() => ({ theme: "dark" }));

/** Couleur d'une variable CSS du thème affiché. */
export function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Applique le thème choisi dans les préférences et le suit : changement de réglage (dans n'importe quelle fenêtre)
 * ou, en mode « system », changement du thème du système.
 */
export function initTheme() {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  let preference: ThemePreference | null = null;

  function apply() {
    const next = useDisplayStore.getState().theme;
    const theme = resolveTheme(next, media?.matches ?? true);
    document.documentElement.dataset.theme = theme;
    useThemeStore.setState({ theme });
    // Barre de titre et contrôles natifs de la fenêtre ; null : thème du système.
    if (next !== preference) {
      preference = next;
      getCurrentWindow().setTheme(next === "system" ? null : next).catch(() => {});
    }
  }

  apply();
  useDisplayStore.subscribe((state, prev) => state.theme !== prev.theme && apply());
  media?.addEventListener("change", apply);
}
