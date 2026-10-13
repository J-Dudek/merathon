import { fetchAllQuietly, getBranches, listRemotes } from "../ipc/commands";
import { linkedForge, refreshOpenPullRequests } from "../components/PullRequestList";
import { useAccountsStore } from "../store/useAccountsStore";
import { useRepoStore } from "../store/useRepoStore";
import { prFreshness, seenKey, useSeenPrsStore, type SeenPr } from "../store/useSeenPrsStore";
import { tabPath, useTabsStore } from "../store/useTabsStore";
import { useUiStore } from "../store/useUiStore";
import { trimEndChars } from "./strings";
import type { ForgePR } from "../types/forge";
import type { BranchInfo } from "../types/git";

export interface RepoChanges {
  newBranches: string[];
  updatedBranches: string[];
  deletedBranches: string[];
  openedPrs: ForgePR[];
  /** PR qui ne sont plus ouvertes (mergées ou fermées). */
  closedPrs: ForgePR[];
  /** PR déjà consultées qui ont changé depuis la synchronisation précédente. */
  updatedPrs: UpdatedPr[];
}

export interface UpdatedPr {
  pr: ForgePR;
  commits: boolean;
  comments: boolean;
}

/** Position des branches distantes, sans les `remote/HEAD` qui suivent la branche par défaut. */
function remoteHeads(branches: BranchInfo[]): Map<string, string> {
  return new Map(branches.filter((b) => b.is_remote && !b.name.endsWith("/HEAD")).map((b) => [b.name, b.target_hash]));
}

/** Branches distantes apparues, déplacées ou supprimées entre deux lectures. */
export function remoteBranchChanges(before: BranchInfo[], after: BranchInfo[]) {
  const old = remoteHeads(before);
  const now = remoteHeads(after);
  const newBranches: string[] = [];
  const updatedBranches: string[] = [];
  for (const [name, hash] of now) {
    if (!old.has(name)) newBranches.push(name);
    else if (old.get(name) !== hash) updatedBranches.push(name);
  }
  const deletedBranches = [...old.keys()].filter((name) => !now.has(name));
  return { newBranches, updatedBranches, deletedBranches };
}

/**
 * PR ouvertes apparues ou disparues, et PR déjà consultées (`seenOf`) qui ont changé depuis la liste précédente.
 * Rien si la liste n'avait jamais été chargée.
 */
export function pullRequestChanges(before: ForgePR[] | null, after: ForgePR[], seenOf: (pr: ForgePR) => SeenPr | undefined = () => undefined) {
  if (!before) return { openedPrs: [], closedPrs: [], updatedPrs: [] };
  const old = new Map(before.map((pr) => [pr.number, pr]));
  const now = new Set(after.map((pr) => pr.number));
  const updatedPrs: UpdatedPr[] = [];
  for (const pr of after) {
    const prev = old.get(pr.number);
    if (!prev || pr.updatedAt <= prev.updatedAt) continue;
    const freshness = prFreshness(seenOf(pr), pr);
    if (freshness.kind === "updated") updatedPrs.push({ pr, commits: freshness.commits, comments: freshness.comments });
  }
  return {
    openedPrs: after.filter((pr) => !old.has(pr.number)),
    closedPrs: before.filter((pr) => !now.has(pr.number)),
    updatedPrs,
  };
}

function updateLabel({ commits, comments }: UpdatedPr): string {
  if (commits && comments) return "nouveaux commits et commentaires";
  if (commits) return "nouveaux commits";
  return comments ? "nouveaux commentaires" : "nouvelle activité";
}

function names(list: string[]): string {
  return list.length > 3 ? `${list.slice(0, 3).join(", ")}…` : list.join(", ");
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Résumé des changements d'un dépôt pour une notification, null s'il n'y en a aucun. */
export function describeChanges(repoName: string, c: RepoChanges, prLabel = "PR"): string | null {
  const parts: string[] = [];
  if (c.newBranches.length) parts.push(`${plural(c.newBranches.length, "nouvelle branche")} (${names(c.newBranches)})`);
  if (c.updatedBranches.length) parts.push(`${plural(c.updatedBranches.length, "branche")} mise${c.updatedBranches.length > 1 ? "s" : ""} à jour (${names(c.updatedBranches)})`);
  if (c.deletedBranches.length) parts.push(`${plural(c.deletedBranches.length, "branche")} supprimée${c.deletedBranches.length > 1 ? "s" : ""}`);
  for (const pr of c.openedPrs) parts.push(`${prLabel} #${pr.number} ouverte « ${pr.title} »`);
  for (const pr of c.closedPrs) parts.push(`${prLabel} #${pr.number} fermée ou mergée`);
  for (const u of c.updatedPrs) parts.push(`${prLabel} #${u.pr.number} : ${updateLabel(u)}`);
  return parts.length ? `${repoName} : ${parts.join(" · ")}` : null;
}

function repoName(path: string): string {
  return trimEndChars(path, "\\/").split(/[\\/]/).pop() || path;
}

/** Dépôts ouverts dans les onglets de la fenêtre, sans doublon. */
function openRepos(): string[] {
  const { tabs, activeId } = useTabsStore.getState();
  return [...new Set(tabs.map((t) => tabPath(t, activeId)).filter((p): p is string => !!p))];
}

/** Fetch d'un dépôt, actualisation de ses PR ouvertes et du graphe s'il est affiché ; renvoie ce qui a changé. */
async function syncRepo(path: string): Promise<{ changes: RepoChanges; prLabel: string }> {
  const before = await getBranches(path);
  await fetchAllQuietly(path);
  const after = await getBranches(path);

  const repo = useRepoStore.getState();
  if (repo.repoPath === path && !useUiStore.getState().busy) await repo.refresh();

  let prs: Pick<RepoChanges, "openedPrs" | "closedPrs" | "updatedPrs"> = { openedPrs: [], closedPrs: [], updatedPrs: [] };
  const forge = linkedForge(await listRemotes(path), useAccountsStore.getState().accounts);
  if (forge) {
    const { before: oldPrs, after: newPrs } = await refreshOpenPullRequests(forge.account, forge.projectPath);
    const { seen } = useSeenPrsStore.getState();
    prs = pullRequestChanges(oldPrs, newPrs, (pr) => seen[seenKey(forge.account.id, forge.projectPath, pr.number)]);
  }
  return {
    changes: { ...remoteBranchChanges(before, after), ...prs },
    prLabel: forge?.account.provider === "gitlab" ? "MR" : "PR",
  };
}

let running = false;
const syncedListeners = new Set<() => void>();

/** Appelé à la fin de chaque synchronisation ; renvoie la fonction de désinscription. */
export function onSynced(listener: () => void): () => void {
  syncedListeners.add(listener);
  return () => {
    syncedListeners.delete(listener);
  };
}

/** Synchronise chaque dépôt ouvert et notifie les changements. Silencieux en cas d'erreur (hors ligne, accès refusé…). */
export async function syncOpenRepos() {
  if (running) return;
  running = true;
  try {
    for (const path of openRepos()) {
      // Une opération lancée par l'utilisateur (pull, push…) est en cours : on attendra le prochain passage.
      if (useUiStore.getState().busy) return;
      try {
        const { changes, prLabel } = await syncRepo(path);
        const message = describeChanges(repoName(path), changes, prLabel);
        if (message) useUiStore.getState().notify("info", message);
      } catch (e) {
        console.warn(`Synchronisation de ${path} impossible :`, e);
      }
    }
  } finally {
    running = false;
    syncedListeners.forEach((l) => l());
  }
}

/** Lance la synchronisation toutes les `minutes` (0 : aucune) ; renvoie la fonction qui l'arrête. */
export function startAutoSync(minutes: number): () => void {
  if (minutes <= 0) return () => {};
  const timer = setInterval(() => void syncOpenRepos(), minutes * 60 * 1000);
  return () => clearInterval(timer);
}
