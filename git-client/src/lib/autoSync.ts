import { useSyncExternalStore } from "react";
import { fetchAllQuietly, getBranches, listRemotes, pullFastForward, type FastForwardPull } from "../ipc/commands";
import { linkedForge, refreshOpenPullRequests } from "../components/PullRequestList";
import { useAccountsStore } from "../store/useAccountsStore";
import { useRepoStore } from "../store/useRepoStore";
import { prFreshness, seenKey, useSeenPrsStore, type SeenPr } from "../store/useSeenPrsStore";
import { tabPath, useTabsStore } from "../store/useTabsStore";
import { useUiStore } from "../store/useUiStore";
import { syncMyPullRequests } from "./prNotifications";
import { trimEndChars } from "./strings";
import type { ForgePR } from "../types/forge";
import type { BranchInfo } from "../types/git";
import { tr, trn, COLON } from "../i18n";

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
  if (commits && comments) return tr("nouveaux commits et commentaires");
  if (commits) return tr("nouveaux commits");
  return comments ? tr("nouveaux commentaires") : tr("nouvelle activité");
}

function names(list: string[]): string {
  return list.length > 3 ? `${list.slice(0, 3).join(", ")}…` : list.join(", ");
}


/** Résumé des changements d'un dépôt pour une notification, null s'il n'y en a aucun. */
export function describeChanges(repoName: string, c: RepoChanges, prLabel = "PR"): string | null {
  const parts: string[] = [];
  if (c.newBranches.length) parts.push(trn(c.newBranches.length, "{n} nouvelle branche ({names})", "{n} nouvelles branches ({names})", { names: names(c.newBranches) }));
  if (c.updatedBranches.length) parts.push(trn(c.updatedBranches.length, "{n} branche mise à jour ({names})", "{n} branches mises à jour ({names})", { names: names(c.updatedBranches) }));
  if (c.deletedBranches.length) parts.push(trn(c.deletedBranches.length, "{n} branche supprimée", "{n} branches supprimées"));
  for (const pr of c.openedPrs) parts.push(tr("{prLabel} #{number} ouverte « {title} »", { prLabel, number: pr.number, title: pr.title }));
  for (const pr of c.closedPrs) parts.push(tr("{prLabel} #{number} fermée ou mergée", { prLabel, number: pr.number }));
  for (const u of c.updatedPrs) parts.push(`${prLabel} #${u.pr.number}${COLON}${updateLabel(u)}`);
  return parts.length ? `${repoName}${COLON}${parts.join(" · ")}` : null;
}

function repoName(path: string): string {
  return trimEndChars(path, "\\/").split(/[\\/]/).pop() || path;
}

/** Dépôts ouverts dans les onglets de la fenêtre, sans doublon. */
function openRepos(): string[] {
  const { tabs, activeId } = useTabsStore.getState();
  return [...new Set(tabs.map((t) => tabPath(t, activeId)).filter((p): p is string => !!p))];
}

/**
 * Retire ce que je n'ai pas à apprendre sur mes propres PR / MR : leurs nouveaux commits (les miens, ou ceux
 * de ma branche) et les « branches mises à jour » correspondantes. Les commentaires restent signalés.
 */
export function withoutOwnCommits(
  updated: UpdatedPr[], branches: string[], open: ForgePR[], me: string,
): { updatedPrs: UpdatedPr[]; updatedBranches: string[] } {
  const mine = (pr: ForgePR) => !!me && pr.author.toLowerCase() === me.toLowerCase();
  const updatedPrs = updated
    .filter((u) => !(mine(u.pr) && u.commits && !u.comments))
    .map((u) => (mine(u.pr) ? { ...u, commits: false } : u));
  const own = open.filter(mine).map((pr) => pr.sourceBranch);
  return { updatedPrs, updatedBranches: branches.filter((b) => !own.some((src) => b === src || b.endsWith(`/${src}`))) };
}

/**
 * Fetch d'un dépôt, actualisation de ses PR ouvertes et du graphe s'il est affiché ; renvoie ce qui a changé.
 * Les PR de `followed` (les miennes, déjà notifiées par `syncMyPullRequests`) ne sont pas signalées une seconde fois.
 */
async function syncRepo(path: string, followed: Set<string>): Promise<{ changes: RepoChanges; prLabel: string }> {
  const before = await getBranches(path);
  await fetchAllQuietly(path);
  const after = await getBranches(path);

  const repo = useRepoStore.getState();
  if (repo.repoPath === path && !useUiStore.getState().busy) await repo.refresh();

  const branchChanges = remoteBranchChanges(before, after);
  let prs: Pick<RepoChanges, "openedPrs" | "closedPrs" | "updatedPrs"> = { openedPrs: [], closedPrs: [], updatedPrs: [] };
  const forge = linkedForge(await listRemotes(path), useAccountsStore.getState().accounts);
  if (forge) {
    const { before: oldPrs, after: newPrs } = await refreshOpenPullRequests(forge.account, forge.projectPath);
    const { seen } = useSeenPrsStore.getState();
    prs = pullRequestChanges(oldPrs, newPrs, (pr) => seen[seenKey(forge.account.id, forge.projectPath, pr.number)]);
    const isFollowed = (pr: ForgePR) => followed.has(seenKey(forge.account.id, forge.projectPath, pr.number).toLowerCase());
    prs.openedPrs = prs.openedPrs.filter((pr) => !isFollowed(pr));
    prs.updatedPrs = prs.updatedPrs.filter((u) => !isFollowed(u.pr));
    const own = withoutOwnCommits(prs.updatedPrs, branchChanges.updatedBranches, newPrs, forge.account.username);
    prs.updatedPrs = own.updatedPrs;
    branchChanges.updatedBranches = own.updatedBranches;
  }
  return {
    changes: { ...branchChanges, ...prs },
    prLabel: forge?.account.provider === "gitlab" ? "MR" : "PR",
  };
}

/** Marqueur des fetch refusés par la clé SSH de l'appareil, faute de pouvoir demander la confirmation (android_keystore.rs). */
const DEVICE_KEY_LOCKED = "device-ssh-key-locked";
const lockedNotified = new Set<string>();

export function isDeviceKeyLocked(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes(DEVICE_KEY_LOCKED);
}

let running = false;
const syncedListeners = new Set<() => void>();
const runningListeners = new Set<() => void>();

function setRunning(value: boolean) {
  running = value;
  runningListeners.forEach((l) => l());
}

/** Vrai pendant une synchronisation, qu'elle soit automatique ou lancée à la main. */
export function useSyncRunning(): boolean {
  return useSyncExternalStore(
    (listener) => {
      runningListeners.add(listener);
      return () => runningListeners.delete(listener);
    },
    () => running,
  );
}

/** Appelé à la fin de chaque synchronisation ; renvoie la fonction de désinscription. */
export function onSynced(listener: () => void): () => void {
  syncedListeners.add(listener);
  return () => {
    syncedListeners.delete(listener);
  };
}

/**
 * Notifie l'activité de mes PR / MR, puis synchronise chaque dépôt ouvert et notifie ses changements.
 * Silencieux en cas d'erreur (hors ligne, accès refusé…).
 */
export async function syncOpenRepos() {
  if (running) return;
  setRunning(true);
  try {
    const followed = await syncMyPullRequests();
    for (const path of openRepos()) {
      // Une opération lancée par l'utilisateur (pull, push…) est en cours : on attendra le prochain passage.
      if (useUiStore.getState().busy) return;
      try {
        const { changes, prLabel } = await syncRepo(path, followed);
        const message = describeChanges(repoName(path), changes, prLabel);
        if (message) useUiStore.getState().notify("info", message);
      } catch (e) {
        reportSyncError(path, e);
      }
    }
  } finally {
    setRunning(false);
    syncedListeners.forEach((l) => l());
  }
}

/** Échec silencieux d'une synchronisation automatique, sauf la clé SSH verrouillée, signalée une fois par dépôt. */
function reportSyncError(path: string, e: unknown) {
  if (isDeviceKeyLocked(e)) {
    // Android : aucune confirmation en arrière-plan. Signalé une seule fois par dépôt, sans erreur répétée.
    if (!lockedNotified.has(path)) {
      lockedNotified.add(path);
      useUiStore.getState().notify("info", tr("Synchronisation de {repo} en pause : la clé SSH de l'appareil est verrouillée. Un fetch lancé à la main demandera la confirmation.", { repo: repoName(path) }));
    }
    return;
  }
  console.warn(`Synchronisation de ${path} impossible :`, e);
}

/** Message d'un pull automatique, null quand il n'y a rien à signaler (déjà à jour, rien à tirer). */
export function describePull(repo: string, result: FastForwardPull): string | null {
  switch (result.kind) {
    case "updated":
      return trn(result.commits, "{repo} : {n} nouveau commit récupéré sur {branch}", "{repo} : {n} nouveaux commits récupérés sur {branch}", { repo, branch: result.branch });
    case "diverged":
      return tr("{repo} : pull non fait, {branch} a des commits locaux absents du serveur (merge ou rebase à faire)", { repo, branch: result.branch });
    case "localChanges":
      return tr("{repo} : pull non fait, des modifications locales sur {branch} seraient écrasées", { repo, branch: result.branch });
    default:
      return null;
  }
}

/**
 * Lancement de l'application (Android) : pull de chaque dépôt ouvert, en fast-forward seulement. Une branche
 * divergente ou des modifications locales en conflit sont laissées telles quelles et signalées.
 */
export async function pullOpenRepos() {
  if (running) return;
  setRunning(true);
  try {
    for (const path of openRepos()) {
      if (useUiStore.getState().busy) return;
      try {
        const result = await pullFastForward(path);
        const message = describePull(repoName(path), result);
        if (message) useUiStore.getState().notify(result.kind === "updated" ? "success" : "info", message);
        const repo = useRepoStore.getState();
        if (result.kind === "updated" && repo.repoPath === path && !useUiStore.getState().busy) await repo.refresh();
      } catch (e) {
        reportSyncError(path, e);
      }
    }
  } finally {
    setRunning(false);
    syncedListeners.forEach((l) => l());
  }
}

/** Lance la synchronisation toutes les `minutes` (0 : aucune) ; renvoie la fonction qui l'arrête. */
export function startAutoSync(minutes: number): () => void {
  if (minutes <= 0) return () => {};
  const timer = setInterval(() => void syncOpenRepos(), minutes * 60 * 1000);
  return () => clearInterval(timer);
}
