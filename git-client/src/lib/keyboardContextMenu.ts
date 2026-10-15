/**
 * Menus contextuels au clavier : la touche Menu ou Maj+F10 ouvre le menu de l'élément qui a le focus, comme un clic droit.
 * Un événement `contextmenu` est envoyé à l'élément : les gestionnaires `onContextMenu` existants servent tels quels.
 */

export const isContextMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/** Point d'ouverture du menu : sous le début de l'élément, comme s'il avait été cliqué là. */
export function contextMenuPoint(rect: { left: number; bottom: number; width: number }): { x: number; y: number } {
  return { x: rect.left + Math.min(rect.width / 2, 16), y: rect.bottom };
}

/** Ouvre le menu contextuel de `el` ; vrai si un gestionnaire l'a ouvert (événement annulé). */
export function dispatchContextMenu(el: Element): boolean {
  const { x, y } = contextMenuPoint(el.getBoundingClientRect());
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  return !el.dispatchEvent(event);
}

/** À brancher sur `keydown` de la fenêtre ; les composants qui gèrent la touche eux-mêmes appellent `preventDefault`. */
export function openContextMenuFromKeyboard(e: KeyboardEvent): void {
  if (e.defaultPrevented || !isContextMenuKey(e)) return;
  const target = document.activeElement;
  // Dans le terminal intégré, les touches vont au shell.
  if (!(target instanceof HTMLElement) || target === document.body || target.closest(".xterm")) return;
  e.preventDefault();
  dispatchContextMenu(target);
}

/**
 * Choix suivant d'un menu au clavier, en sautant les choix désactivés et en bouclant.
 * `step` : 1 / -1 (flèches), ou `"first"` / `"last"` (Origine / Fin). -1 si aucun choix n'est actif.
 */
export function nextMenuIndex(enabled: boolean[], current: number, step: 1 | -1 | "first" | "last"): number {
  const n = enabled.length;
  if (!enabled.some(Boolean)) return -1;
  if (step === "first") return enabled.indexOf(true);
  if (step === "last") return enabled.lastIndexOf(true);
  // Sans choix courant, la flèche vers le haut part de la fin.
  let i = current < 0 && step === -1 ? n : current;
  do i = (i + step + n) % n;
  while (!enabled[i]);
  return i;
}

/**
 * Ligne visée par une touche de navigation dans une liste (graphe des commits), ou null pour une autre touche.
 * `current` : ligne sélectionnée (-1 si aucune) ; `page` : lignes visibles, pour Page préc. / suiv.
 */
export function listKeyIndex(key: string, current: number, count: number, page: number): number | null {
  if (count === 0) return null;
  const from = Math.max(current, 0);
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case "ArrowUp":
      return Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return Math.min(count - 1, from + page);
    case "PageUp":
      return Math.max(0, from - page);
    default:
      return null;
  }
}
