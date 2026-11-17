import type { BranchInfo } from "../types/git";
import { isServer } from "./platform";

/**
 * NAS : branches distantes de chaque dépôt telles que cette page les connaît déjà, pour le bandeau des changements de la
 * synchronisation automatique.
 *
 * Sur le bureau, ce bandeau compare les branches avant et après le fetch de la synchronisation. Sur le NAS, plusieurs
 * pages fetchent les mêmes dépôts : si une autre page a fetché la première, les nouveaux commits sont déjà là avant le
 * fetch de celle-ci (que le serveur saute d'ailleurs, voir server/repo_queue.rs), et le bandeau ne disait rien. La
 * comparaison part donc de ce que cette page connaissait : sa dernière synchronisation, ou l'ouverture du dépôt.
 *
 * Les opérations réseau lancées par la page (fetch, pull, push…) effacent l'état mémorisé : leurs effets ne sont pas à
 * lui annoncer, le rafraîchissement qui les suit le remplace. Le rafraîchissement du graphe déclenché par la
 * surveillance des fichiers ne le remplace pas : les commits arrivés par une autre page restent à signaler.
 */
const snapshots = new Map<string, BranchInfo[]>();

/** Branches distantes connues de cette page pour `path` ; toujours `undefined` hors du NAS. */
export function knownRemoteBranches(path: string): BranchInfo[] | undefined {
  return isServer() ? snapshots.get(path) : undefined;
}

/** Fin d'une synchronisation : la page connaît maintenant ces branches. */
export function rememberRemoteBranches(path: string, branches: BranchInfo[]) {
  if (isServer()) snapshots.set(path, branches);
}

/** Dépôt affiché (ouverture, rafraîchissement) : point de départ, s'il n'y en a pas déjà un. */
export function rememberRemoteBranchesIfUnknown(path: string, branches: BranchInfo[]) {
  if (isServer() && !snapshots.has(path)) snapshots.set(path, branches);
}

/** Opération réseau lancée par cette page : ses effets ne seront pas annoncés. */
export function forgetRemoteBranches(path: string) {
  snapshots.delete(path);
}
