/**
 * Plateforme de l'application. Sur mobile (Android), il n'y a ni terminal, ni mises à jour hors du store, ni
 * fenêtres multiples : ces fonctions servent à masquer ce qui n'y existe pas. Lues à chaque appel (et non une
 * fois pour toutes) pour pouvoir simuler une plateforme dans les tests.
 */
export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export function isMobile(): boolean {
  return isAndroid() || /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Terminal intégré, nouvelles fenêtres et mises à jour automatiques : bureau seulement. */
export function hasDesktopFeatures(): boolean {
  return !isMobile();
}

/**
 * Tablette : appareil mobile dont le plus petit côté de l'écran fait au moins 600 px (CSS), le seuil d'Android
 * (« sw600dp »). Indépendant de l'orientation : une tablette reste une tablette en portrait, un téléphone reste
 * un téléphone en paysage.
 */
export const TABLET_MIN_SIDE = 600;

export function isTablet(): boolean {
  return isMobile() && Math.min(window.screen.width, window.screen.height) >= TABLET_MIN_SIDE;
}

/** Téléphone : mobile à petit écran, avec les vues dédiées (diff compact en plein écran…). */
export function isPhone(): boolean {
  return isMobile() && !isTablet();
}
