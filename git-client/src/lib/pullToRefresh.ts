/** Distance de tirage (px de l'indicateur) à partir de laquelle relâcher lance l'actualisation. */
export const PULL_THRESHOLD = 64;
/** Course maximale de l'indicateur. */
export const PULL_MAX = 110;
/** Tirage minimal avant de considérer le geste comme un « tirer pour actualiser » (px de doigt). */
export const PULL_SLOP = 10;

/** Course de l'indicateur pour un déplacement du doigt de `dy` px : de plus en plus dure à tirer, plafonnée. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX, dy * 0.5);
}

export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}

/** Vrai si le geste est plutôt horizontal (défilement d'un diff, d'un onglet…) : pas un tirage vers le bas. */
export function isHorizontal(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy);
}

/**
 * Le geste peut-il commencer un tirage ? Seulement si aucune zone défilante entre le doigt et `boundary` n'est
 * déjà défilée (sinon le doigt fait défiler), et hors zone de saisie ou zone qui se désigne `data-no-pull`.
 */
export function canStartPull(target: EventTarget | null, boundary: HTMLElement): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== boundary.parentElement) {
    if (el.matches("input, textarea, select, [contenteditable=true], [data-no-pull]")) return false;
    if (el.scrollTop > 0) return false;
    if (el === boundary) return true;
    el = el.parentElement;
  }
  return false;
}
