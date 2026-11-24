import type { DiffHunk, DiffLine } from "../types/git";

/** Paliers proposés pour dérouler le contexte autour d'un bloc. */
export const CONTEXT_STEPS = [5, 10] as const;

/** Lignes déjà dépliées autour d'un bloc. */
export interface Expansion {
  up: number;
  down: number;
}

/** Plage de lignes (à partir de 1, bornes comprises) de la nouvelle version du fichier. */
export interface LineRange {
  from: number;
  to: number;
}

/** Ce qu'il faut afficher autour d'un bloc, et ce qu'il reste à dérouler. */
export interface HunkContext {
  above: LineRange | null;
  below: LineRange | null;
  /** Lignes encore cachées au-dessus / en dessous (`Infinity` tant que la longueur du fichier est inconnue). */
  hiddenAbove: number;
  hiddenBelow: number;
  /** Décalage ancien numéro − nouveau numéro, au-dessus et en dessous du bloc. */
  offsetAbove: number;
  offsetBelow: number;
}

/** Première et dernière ligne du bloc dans la nouvelle version (plage vide pour une suppression pure sans contexte). */
function bounds(hunk: DiffHunk): { min: number; max: number } {
  const numbers = hunk.lines.map((l) => l.new_lineno).filter((n): n is number => n != null);
  return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : { min: hunk.new_start + 1, max: hunk.new_start };
}

function offsetAfter(hunk: DiffHunk): number {
  const both = [...hunk.lines].reverse().find((l: DiffLine) => l.old_lineno != null && l.new_lineno != null);
  return both ? both.old_lineno! - both.new_lineno! : hunk.old_start - hunk.new_start;
}

/**
 * Plages à afficher autour de chaque bloc. Entre deux blocs, ce que le bas du premier et le haut du second déplient
 * ne se recouvre jamais ; `total` est le nombre de lignes du fichier (`null` s'il n'est pas encore connu).
 */
export function contextAround(hunks: DiffHunk[], expansions: Expansion[], total: number | null): HunkContext[] {
  const limit = total ?? Infinity;
  const b = hunks.map(bounds);
  const result: HunkContext[] = hunks.map((h) => ({
    above: null,
    below: null,
    hiddenAbove: 0,
    hiddenBelow: 0,
    offsetAbove: h.old_start - h.new_start,
    offsetBelow: offsetAfter(h),
  }));
  // Intervalle i : entre le bloc i − 1 (par le bas) et le bloc i (par le haut) ; 0 = début du fichier, n = fin.
  for (let i = 0; i <= hunks.length; i++) {
    const start = i === 0 ? 1 : b[i - 1].max + 1;
    const end = i === hunks.length ? limit : b[i].min - 1;
    const size = Math.max(0, end - start + 1);
    const down = i > 0 ? Math.min(expansions[i - 1]?.down ?? 0, size) : 0;
    const up = i < hunks.length ? Math.min(expansions[i]?.up ?? 0, size - down) : 0;
    const hidden = size - down - up;
    if (i > 0) fillBelow(result[i - 1], start, down, hidden);
    if (i < hunks.length) fillAbove(result[i], end, up, hidden);
  }
  return result;
}

function fillBelow(context: HunkContext, start: number, count: number, hidden: number) {
  context.below = count > 0 ? { from: start, to: start + count - 1 } : null;
  context.hiddenBelow = hidden;
}

function fillAbove(context: HunkContext, end: number, count: number, hidden: number) {
  context.above = count > 0 ? { from: end - count + 1, to: end } : null;
  context.hiddenAbove = hidden;
}

/** Lignes de contexte d'une plage, avec leur ancien numéro déduit du décalage du bloc voisin. */
export function contextLines(lines: string[], range: LineRange | null, offset: number): DiffLine[] {
  if (!range) return [];
  const out: DiffLine[] = [];
  for (let n = range.from; n <= range.to && n <= lines.length; n++) {
    out.push({ kind: "context", content: lines[n - 1], old_lineno: n + offset, new_lineno: n });
  }
  return out;
}
