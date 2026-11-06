import { tr } from "../i18n";

// Séparé de terminals.ts, qui charge xterm.js : le panneau du bas affiche ces indications sans charger le terminal.

export const LEAVE_TERMINAL_SHORTCUT = "Ctrl+Maj+J";
export const LEAVE_TERMINAL_HINT = tr("{LEAVE_TERMINAL_SHORTCUT} pour en sortir", { LEAVE_TERMINAL_SHORTCUT });

/** Rend le focus à l'onglet « Terminal » du panneau du bas, d'où la tabulation reprend dans l'application. */
export function leaveTerminal(): void {
  const tab = document.querySelector<HTMLElement>("[data-panel-tab=terminal]");
  if (tab) tab.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
}
