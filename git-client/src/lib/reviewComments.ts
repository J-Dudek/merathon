import type { DiffLine } from "../types/git";
import type { DiffSide, DraftComment, LinePosition, ReviewThread } from "../types/forge";

/** Emplacement d'un commentaire sur une ligne : nouvelle version, sauf pour une ligne supprimée. */
export function linePosition(line: DiffLine, path: string, oldPath: string | null): LinePosition | null {
  const side: DiffSide = line.kind === "removed" ? "old" : "new";
  const number = side === "old" ? line.old_lineno : line.new_lineno;
  if (number == null) return null;
  return { path, oldPath: oldPath ?? path, side, line: number, oldLine: line.old_lineno, newLine: line.new_lineno };
}

const key = (side: DiffSide, line: number) => `${side}:${line}`;

/** Clés sous lesquelles une ligne du diff reçoit des commentaires (une ligne inchangée existe des deux côtés). */
export function lineKeys(line: DiffLine): string[] {
  const keys: string[] = [];
  if (line.kind !== "removed" && line.new_lineno != null) keys.push(key("new", line.new_lineno));
  if (line.kind !== "added" && line.old_lineno != null) keys.push(key("old", line.old_lineno));
  return keys;
}

/** Fils et brouillons d'un fichier, indexés par ligne ; les fils sans ligne actuelle sont « obsolètes ». */
export function indexComments(path: string, threads: ReviewThread[], drafts: DraftComment[]) {
  const threadsByLine = new Map<string, ReviewThread[]>();
  const outdated: ReviewThread[] = [];
  for (const t of threads) {
    if (t.path !== path) continue;
    if (t.line == null) {
      outdated.push(t);
      continue;
    }
    const k = key(t.side, t.line);
    threadsByLine.set(k, [...(threadsByLine.get(k) ?? []), t]);
  }
  const draftsByLine = new Map<string, DraftComment[]>();
  for (const d of drafts) {
    if (d.position.path !== path) continue;
    const k = key(d.position.side, d.position.line);
    draftsByLine.set(k, [...(draftsByLine.get(k) ?? []), d]);
  }
  return { threadsByLine, draftsByLine, outdated };
}

export const positionKey = (p: LinePosition) => `${p.path}|${key(p.side, p.line)}`;
