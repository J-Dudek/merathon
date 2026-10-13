/**
 * Fichiers marqués « vus » pendant la revue d'une PR / MR, mémorisés dans ce navigateur uniquement.
 * Ils sont liés au commit de tête : un nouveau push remet la revue à zéro.
 */
const storageKey = (prKey: string) => `merathon.viewed.${prKey}`;

export function loadViewed(prKey: string, head: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(prKey));
    if (!raw) return new Set();
    const saved = JSON.parse(raw) as { head?: string; paths?: unknown };
    return saved.head === head && Array.isArray(saved.paths) ? new Set(saved.paths.filter((p) => typeof p === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveViewed(prKey: string, head: string, paths: Set<string>) {
  try {
    if (paths.size) localStorage.setItem(storageKey(prKey), JSON.stringify({ head, paths: [...paths] }));
    else localStorage.removeItem(storageKey(prKey));
  } catch {
    // Stockage indisponible : le suivi reste valable pour la session.
  }
}
