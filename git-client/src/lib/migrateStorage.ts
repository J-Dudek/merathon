/** Préfixes des réglages enregistrés avant et après le renommage de l'application en Merathon. */
const LEGACY_PREFIX = "git-client.";
const PREFIX = "merathon.";

/**
 * Reprend les réglages enregistrés sous l'ancien préfixe (thème, onglets ouverts, dépôts récents, PR lues…).
 * Une valeur déjà présente sous le nouveau préfixe n'est pas écrasée.
 */
export function migrateStorage(storage: Storage): void {
  const legacy: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
  }
  for (const key of legacy) {
    const next = PREFIX + key.slice(LEGACY_PREFIX.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(next) === null) storage.setItem(next, value);
    storage.removeItem(key);
  }
}

// À l'import : les stores lisent leurs réglages dès leur chargement.
try {
  migrateStorage(localStorage);
} catch {
  // stockage indisponible : rien à reprendre
}
