import { ancestorsOf } from "./ancestry";
import type { BranchInfo, CommitInfo, RefLabel } from "../types/git";

/** Branches masquées du graphe, ou seules affichées (solo, prioritaire) ; clés de `refKey` / `branchKey`. */
export interface GraphFilter {
  hidden: string[];
  solo: string[];
}

export const EMPTY_FILTER: GraphFilter = { hidden: [], solo: [] };

/** Clé d'une étiquette du graphe : « local:main », « remote:origin/main », « tag:v1.0 ». */
export function refKey(ref: RefLabel): string {
  if (ref.kind === "remote") return `remote:${ref.name}`;
  if (ref.kind === "tag") return `tag:${ref.name}`;
  return `local:${ref.name}`;
}

export const branchKey = (b: BranchInfo) => `${b.is_remote ? "remote" : "local"}:${b.name}`;

/** Ne garde que les clés de branches qui existent encore (une branche supprimée ne filtre plus rien). */
export function effectiveFilter(filter: GraphFilter, branches: BranchInfo[]): GraphFilter {
  const existing = new Set(branches.map(branchKey));
  return { hidden: filter.hidden.filter((k) => existing.has(k)), solo: filter.solo.filter((k) => existing.has(k)) };
}

/**
 * Commits du graphe filtré : ceux accessibles depuis les branches affichées (et les tags, hors solo).
 * Les étiquettes des branches non affichées sont retirées des commits restants.
 */
export function filterGraph(commits: CommitInfo[], filter: GraphFilter): CommitInfo[] {
  if (!filter.hidden.length && !filter.solo.length) return commits;
  const solo = new Set(filter.solo);
  const hidden = new Set(filter.hidden);
  const isShownBranch = (ref: RefLabel) => (solo.size ? solo.has(refKey(ref)) : !hidden.has(refKey(ref)));
  // En solo, un tag ne garde pas ses commits dans le graphe, mais reste affiché sur un commit visible.
  const isTip = (ref: RefLabel) => (ref.kind === "tag" ? !solo.size : isShownBranch(ref));
  const label = (ref: RefLabel) => ref.kind === "tag" || isShownBranch(ref);

  const tips = commits.filter((c) => c.refs.some(isTip)).map((c) => c.hash);
  const visible = ancestorsOf(commits, tips);
  return commits
    .filter((c) => visible.has(c.hash))
    .map((c) => (c.refs.every(label) ? c : { ...c, refs: c.refs.filter(label) }));
}
