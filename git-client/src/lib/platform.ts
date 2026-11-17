/**
 * Plateforme de l'application. Sur mobile (Android), il n'y a ni terminal, ni mises à jour hors du store, ni
 * fenêtres multiples : ces fonctions servent à masquer ce qui n'y existe pas. Lues à chaque appel (et non une
 * fois pour toutes) pour pouvoir simuler une plateforme dans les tests.
 */
export function isAndroid(): boolean {
  return !isServer() && /Android/i.test(navigator.userAgent);
}

export function isMobile(): boolean {
  return isAndroid() || (!isServer() && /iPhone|iPad|iPod/i.test(navigator.userAgent));
}

/**
 * Merathon servi par `merathon-server` (NAS Synology) et ouvert dans un navigateur, sans l'enveloppe Tauri. Choisi à la
 * construction (`vite build --mode server`, voir .env.server). Un navigateur de téléphone y affiche la même interface
 * que celui d'un ordinateur : ce que Merathon fait de propre à Android (clé de l'appareil, tâche de fond) n'y existe pas.
 */
export function isServer(): boolean {
  return import.meta.env.VITE_TARGET === "server";
}

/** Terminal intégré, nouvelles fenêtres et mises à jour automatiques : bureau seulement. */
export function hasDesktopFeatures(): boolean {
  return !isMobile();
}

/** Enveloppe native (Tauri) : mises à jour, pastille de l'icône, thème de la barre de titre. Pas dans un navigateur. */
export function hasNativeShell(): boolean {
  return hasDesktopFeatures() && !isServer();
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
