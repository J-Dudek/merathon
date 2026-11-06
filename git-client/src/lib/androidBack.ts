import type { MobilePane } from "../components/MobileNav";
/** Effet du bouton retour d'Android, du plus au moins imbriqué. */
export type BackAction = "close-overlay" | "show-graph" | "show-history" | "exit";

export function backAction(state: { overlayOpen: boolean; centerIsGraph: boolean; onHistory: boolean }): BackAction {
  if (state.overlayOpen) return "close-overlay";
  if (!state.centerIsGraph) return "show-graph";
  return state.onHistory ? "exit" : "show-history";
}

/** Tiroir, fenêtre ou menu ouvert : tous se ferment avec Échap. */
export function overlayOpen(): boolean {
  return document.querySelector("[role=dialog], [role=menu]") !== null;
}

export function closeOverlay() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

/** Écran affiché sur mobile, et celui à rouvrir quand le centre (diff, fichier…) se referme. */
export interface PaneState {
  pane: MobilePane;
  returnTo: MobilePane | null;
}

/**
 * Mobile : un diff s'affiche au centre (écran « Historique ») ; ouvert depuis la liste des fichiers d'un commit ou
 * depuis « Détails », il ramène à cette liste en se refermant (retour d'Android ou bouton de fermeture), pas au graphe.
 */
export function paneAfterCenterChange(state: PaneState, centerIsGraph: boolean): PaneState {
  if (!centerIsGraph) return { pane: "main", returnTo: state.returnTo ?? (state.pane === "main" ? null : state.pane) };
  return state.returnTo ? { pane: state.returnTo, returnTo: null } : state;
}
