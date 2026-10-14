import type { CommitInfo } from "../types/git";

/** Commits accessibles depuis `from` (eux compris) en remontant les parents, parmi les commits chargés. */
export function ancestorsOf(commits: CommitInfo[], from: string | string[] | null | undefined): Set<string> {
  const seen = new Set<string>();
  if (!from) return seen;
  const parents = new Map(commits.map((c) => [c.hash, c.parents]));
  const stack = Array.isArray(from) ? [...from] : [from];
  while (stack.length) {
    const hash = stack.pop()!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    for (const p of parents.get(hash) ?? []) stack.push(p);
  }
  return seen;
}

/** Une branche en `from` peut avancer jusqu'à `to` sans merge : `from` en est un ancêtre strict. */
export function canFastForward(commits: CommitInfo[], from: string | null | undefined, to: string | null | undefined): boolean {
  return !!from && !!to && from !== to && ancestorsOf(commits, to).has(from);
}
