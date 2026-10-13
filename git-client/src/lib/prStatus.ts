import type { PrSummary } from "../types/forge";

/** Où en est une PR / MR que j'ai ouverte, du plus bloquant au plus avancé. */
export type MyPrStatus = "draft" | "conflicts" | "changes_requested" | "ci_failed" | "review_pending" | "approved";

export const MY_PR_STATUSES: Record<MyPrStatus, { label: string; className: string }> = {
  draft: { label: "Brouillon", className: "border-overlay/20 text-[var(--color-muted)]" },
  conflicts: { label: "Conflits", className: "border-red-500/50 text-red-300" },
  changes_requested: { label: "Changements demandés", className: "border-orange-400/50 text-orange-300" },
  ci_failed: { label: "CI en échec", className: "border-red-500/50 text-red-300" },
  review_pending: { label: "En attente de relecture", className: "border-sky-400/40 text-sky-300" },
  approved: { label: "Approuvée", className: "border-green-500/50 text-green-300" },
};

const ORDER = Object.keys(MY_PR_STATUSES) as MyPrStatus[];

/** État principal : ce qui empêche le merge en premier, sinon l'état de la relecture. */
export function myPrStatus(pr: PrSummary): MyPrStatus {
  if (pr.draft) return "draft";
  if (pr.conflicts) return "conflicts";
  if (pr.review === "changes_requested") return "changes_requested";
  if (pr.ci === "failure") return "ci_failed";
  return pr.review === "approved" ? "approved" : "review_pending";
}

/** Triées par état (les plus bloquées d'abord), puis par activité la plus récente. */
export function sortByStatus(prs: PrSummary[]): PrSummary[] {
  return [...prs].sort((a, b) =>
    ORDER.indexOf(myPrStatus(a)) - ORDER.indexOf(myPrStatus(b)) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Regroupées par projet, projets par ordre alphabétique. */
export function groupByProject(prs: PrSummary[]): [string, PrSummary[]][] {
  const groups = new Map<string, PrSummary[]>();
  for (const pr of prs) groups.set(pr.projectPath, [...(groups.get(pr.projectPath) ?? []), pr]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
