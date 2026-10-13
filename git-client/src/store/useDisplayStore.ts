import { create } from "zustand";

/** Réglages d'affichage, communs à toutes les fenêtres. */
export interface DisplaySettings {
  /** Échelle de toute l'interface (1 = 100 %). */
  zoom: number;
  /** Taille du texte du terminal intégré, en pixels (avant zoom). */
  terminalFontSize: number;
  /** Hauteur des lignes du graphe des commits. */
  density: Density;
  /** Minutes entre deux synchronisations des dépôts ouverts (fetch + PR) ; 0 : désactivée. */
  syncInterval: number;
  /** Thème de couleurs ; « system » suit le réglage clair / sombre du système. */
  theme: ThemePreference;
}

export type ThemePreference = "system" | "dark" | "light";
const THEMES: ThemePreference[] = ["system", "dark", "light"];

export type Density = "compact" | "normal" | "comfortable";

export const ROW_HEIGHTS: Record<Density, number> = { compact: 22, normal: 28, comfortable: 36 };
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const TERMINAL_FONT_MIN = 9;
export const TERMINAL_FONT_MAX = 24;
/** Intervalles de synchronisation proposés, en minutes (0 : désactivée). */
export const SYNC_INTERVALS = [0, 1, 2, 5, 10, 15, 30, 60];

export const defaultDisplay: DisplaySettings = { zoom: 1, terminalFontSize: 12, density: "normal", syncInterval: 5, theme: "system" };

const KEY = "git-client.display";

/** Palier de zoom suivant (`direction` = 1) ou précédent (-1), borné aux paliers proposés. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-6) ?? ZOOM_STEPS[0];
}

/** Réglages relus depuis le stockage, valeurs invalides remplacées par les valeurs par défaut. */
export function sanitize(raw: unknown): DisplaySettings {
  const r = (raw ?? {}) as Partial<DisplaySettings>;
  const zoom = typeof r.zoom === "number" && r.zoom >= ZOOM_STEPS[0] && r.zoom <= ZOOM_STEPS[ZOOM_STEPS.length - 1] ? r.zoom : defaultDisplay.zoom;
  const font = typeof r.terminalFontSize === "number" ? Math.round(r.terminalFontSize) : defaultDisplay.terminalFontSize;
  return {
    zoom,
    terminalFontSize: Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, font)),
    density: r.density && r.density in ROW_HEIGHTS ? r.density : defaultDisplay.density,
    syncInterval: SYNC_INTERVALS.includes(r.syncInterval as number) ? r.syncInterval! : defaultDisplay.syncInterval,
    theme: THEMES.includes(r.theme as ThemePreference) ? r.theme! : defaultDisplay.theme,
  };
}

function load(): DisplaySettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : defaultDisplay;
  } catch {
    return defaultDisplay;
  }
}

interface DisplayStore extends DisplaySettings {
  update: (patch: Partial<DisplaySettings>) => void;
  reset: () => void;
}

export const useDisplayStore = create<DisplayStore>((set, get) => {
  function save(next: DisplaySettings) {
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible : réglages gardés pour la session
    }
  }
  const current = (): DisplaySettings => {
    const { zoom, terminalFontSize, density, syncInterval, theme } = get();
    return { zoom, terminalFontSize, density, syncInterval, theme };
  };
  return {
    ...load(),
    update: (patch) => save(sanitize({ ...current(), ...patch })),
    reset: () => save(defaultDisplay),
  };
});

// Une autre fenêtre a changé les réglages : on les reprend.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useDisplayStore.setState(load());
  });
}
