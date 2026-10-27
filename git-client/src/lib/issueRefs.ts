import type { ForgeIssue } from "../types/forge";

/** Mot-clé de fermeture compris par GitHub et GitLab : l'issue est fermée au merge. */
export const CLOSING_KEYWORD = "Closes";

/** Référence d'issue en cours de saisie : le « # » (à `start`) et ce qui le suit jusqu'au curseur. */
export interface IssueQuery {
  start: number;
  query: string;
}

/** « #… » juste avant le curseur, en début de mot (pas « a#1 », ni le second « # » d'un titre Markdown « ## »). */
export function issueQueryAt(text: string, caret: number): IssueQuery | null {
  const m = /(?:^|[\s([{])#([^\s#]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Issues dont le numéro commence par la saisie ou dont le titre la contient (casse et accents ignorés) ; numéro exact en tête. */
export function matchIssues(issues: ForgeIssue[], query: string, limit = 8): ForgeIssue[] {
  const q = fold(query.trim());
  const hits = issues.filter((i) => String(i.number).startsWith(q) || fold(i.title).includes(q));
  const exact = (i: ForgeIssue) => String(i.number) === q;
  return [...hits.filter(exact), ...hits.filter((i) => !exact(i))].slice(0, limit);
}

/** Sans doublon de numéro, dans l'ordre. */
export function uniqueIssues(issues: ForgeIssue[]): ForgeIssue[] {
  const seen = new Set<number>();
  return issues.filter((i) => !seen.has(i.number) && !!seen.add(i.number));
}

/**
 * Remplace la saisie « #… » par la référence `#123` (ou `Closes #123`), suivie d'une espace si rien ne sépare déjà
 * du texte suivant. Renvoie le texte et la position du curseur après la référence.
 */
export function insertIssueRef(text: string, at: IssueQuery, caret: number, number: number, closing = false): { text: string; caret: number } {
  const after = text.slice(caret);
  const keyword = closing ? CLOSING_KEYWORD + " " : "";
  const ref = `${keyword}#${number}${/^\s/.test(after) ? "" : " "}`;
  return { text: text.slice(0, at.start) + ref + after, caret: at.start + ref.length };
}

/** Le texte ferme déjà l'issue : « Closes #12 », « fixes: #12 », « Resolved #12 »… */
export function closesIssue(text: string, number: number): boolean {
  return new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${number}(?!\\d)`, "i").test(text);
}

/** Ajoute « Closes #12 » en fin de description, sauf si elle ferme déjà l'issue. */
export function addClosingRef(text: string, number: number): string {
  if (closesIssue(text, number)) return text;
  const body = text.trimEnd();
  return `${body}${body ? "\n\n" : ""}${CLOSING_KEYWORD} #${number}\n`;
}

/** Numéro d'issue évoqué par le nom de la branche : « feat/123-login », « 123_fix », « fix/issue-42 », « gh-7 ». */
export function issueNumberFromBranch(branch: string): number | null {
  const name = branch.slice(branch.lastIndexOf("/") + 1);
  const m = /^(\d+)(?:[-_]|$)/.exec(name) ?? /(?:^|[-_])(?:issues?|gh)[-_]?(\d+)(?:[-_]|$)/i.exec(name);
  return m ? Number(m[1]) : null;
}
