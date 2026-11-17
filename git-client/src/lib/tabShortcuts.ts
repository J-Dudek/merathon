import { tr } from "../i18n";
import { isServer } from "./platform";

/**
 * Raccourcis des onglets et des fenêtres de Merathon.
 *
 * Dans un onglet de navigateur (NAS), Chrome et Firefox gardent pour eux Ctrl+T, Ctrl+W, Ctrl+N, Ctrl+Tab, Ctrl+Maj+Tab et
 * Ctrl+PgSuiv / PgPréc (Chrome aussi Ctrl+Maj+N) : la page ne les reçoit jamais, et Ctrl+W ferme l'onglet du navigateur.
 * Mesuré avec de vraies frappes (Chrome 157, Firefox, novembre 2026) : les mêmes touches avec Alt arrivent à la page dans
 * les deux navigateurs, le NAS affiche donc celles-là. Les raccourcis Ctrl restent actifs : une fenêtre d'application de
 * Chrome (page installée comme application) les transmet tous à la page.
 */
export interface TabShortcuts {
  newTab: string;
  closeTab: string;
  nextTab: string;
  previousTab: string;
  /** null : pas de nouvelle fenêtre (NAS : dans un navigateur, les onglets de Merathon en tiennent lieu). */
  newWindow: string | null;
}

export function tabShortcuts(): TabShortcuts {
  return isServer()
    ? { newTab: "Alt+T", closeTab: "Alt+W", nextTab: `Alt+${tr("PgSuiv")}`, previousTab: `Alt+${tr("PgPréc")}`, newWindow: null }
    : { newTab: "Ctrl+T", closeTab: "Ctrl+W", nextTab: "Ctrl+Tab", previousTab: "Ctrl+Maj+Tab", newWindow: "Ctrl+Maj+N" };
}

/** Raccourci à citer dans une phrase : « Maj » dans la langue de l'interface (« Shift » en anglais). */
export function keysInText(keys: string): string {
  return keys.split("+").map((key) => (key === "Maj" ? tr("Maj") : key)).join("+");
}

/** Touches des onglets avec Alt sur le NAS, sous le nom des raccourcis Ctrl correspondants (« t », « pagedown »…). */
const BROWSER_TAB_KEYS = new Set(["t", "w", "pagedown", "pageup"]);

/**
 * NAS : nom du raccourci d'onglet tapé avec Alt (« t », « w », « pagedown », « pageup »), sinon null.
 * Sans Ctrl ni Cmd : sous Windows, AltGr envoie Ctrl+Alt. La touche produite (`key`) et non sa position (`code`) : sur un
 * Mac, Option+T écrit « † » et ne doit pas ouvrir d'onglet.
 */
export function browserTabShortcut(e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">): string | null {
  if (!isServer() || !e.altKey || e.ctrlKey || e.metaKey) return null;
  const key = e.key.toLowerCase();
  const name = e.shiftKey ? `shift+${key}` : key;
  return BROWSER_TAB_KEYS.has(name) ? name : null;
}
