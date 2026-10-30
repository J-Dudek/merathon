import { useCallback, useEffect, useReducer, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitCommitHorizontal, GitMerge, GitPullRequestArrow, GitPullRequestClosed, MessageSquare, type LucideIcon } from "lucide-react";
import { useAccountsStore } from "../store/useAccountsStore";
import { useRepoStore } from "../store/useRepoStore";
import { prFreshness, seenKey, seenPrefix, useSeenPrsStore, type PrFreshness } from "../store/useSeenPrsStore";
import { checkoutRemoteBranch, fetchRemote } from "../ipc/commands";
import { errorMessage, runGit } from "../lib/actions";
import { remoteForAccount } from "../lib/remoteUrl";
import { MY_PR_STATUSES } from "../lib/prStatus";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { PullRequestReviewDialog } from "./PullRequestReviewDialog";
import { PR_PAGE_SIZE, type ForgeAccount, type ForgePR, type PullRequestState } from "../types/forge";
import type { RemoteInfo } from "../types/git";

/** Compte et projet de la forge qui hébergent un remote du dépôt courant. */
export interface LinkedForge {
  account: ForgeAccount;
  /** "owner/repo" ou "group/sub/repo". */
  projectPath: string;
  remoteName: string;
}

/** Premier compte dont l'instance héberge un de ces remotes (origin en priorité). */
export function linkedForge(remotes: RemoteInfo[], accounts: ForgeAccount[]): LinkedForge | null {
  for (const account of accounts) {
    const match = remoteForAccount(remotes, account);
    if (match) return { account, projectPath: match.path, remoteName: match.remote.name };
  }
  return null;
}

/** Forge liée au dépôt courant. */
export function useLinkedForge(): LinkedForge | null {
  const remotes = useRepoStore((s) => s.remotes);
  const accounts = useAccountsStore((s) => s.accounts);
  return linkedForge(remotes, accounts);
}

/** Checkout de la branche source d'une PR, après un fetch si elle n'est pas encore connue localement. */
export async function checkoutPullRequest(remoteName: string, pr: ForgePR) {
  const { repoPath, branches } = useRepoStore.getState();
  if (!repoPath) return;
  const remoteBranch = `${remoteName}/${pr.sourceBranch}`;
  if (!branches.some((b) => b.is_remote && b.name === remoteBranch)) {
    await runGit(() => fetchRemote(repoPath, remoteName), { busy: "Fetch…", refresh: false });
  }
  await runGit(() => checkoutRemoteBranch(repoPath, remoteBranch), { success: `Checkout de ${pr.sourceBranch}` });
}

export type PrScope = "all" | "mine" | "review" | "assigned";

function matchesScope(pr: ForgePR, scope: PrScope, me: string): boolean {
  switch (scope) {
    case "mine": return pr.author === me;
    case "review": return pr.reviewers.includes(me);
    case "assigned": return pr.assignees.includes(me);
    default: return true;
  }
}

/**
 * Dernières PR chargées par compte, projet et filtre d'état. Gardées au niveau du module pour survivre au
 * démontage de la liste (changement d'onglet) : les badges des branches restent affichés pendant l'actualisation.
 */
const cache = new Map<string, { open: ForgePR[]; filtered: ForgePR[] }>();

/** Listes affichées à prévenir quand le cache est actualisé hors d'elles (synchronisation périodique). */
const listeners = new Set<() => void>();

/** Nombre de commentaires des PR GitHub par clé de consultation, valable tant que `updatedAt` ne change pas. */
const commentCounts = new Map<string, { updatedAt: string; count: number }>();

/** Vide le cache (tests). */
export function clearPullRequestCache() {
  cache.clear();
  commentCounts.clear();
}

/** PR avec son nombre de commentaires : la liste GitHub ne le donne pas, une requête par PR est nécessaire. */
async function withCommentCount<T extends ForgePR>(account: ForgeAccount, projectPath: string, pr: T): Promise<T> {
  if (pr.commentCount !== undefined) return pr;
  const key = seenKey(account.id, projectPath, pr.number);
  const known = commentCounts.get(key);
  if (known?.updatedAt === pr.updatedAt) return { ...pr, commentCount: known.count };
  const full = await (await useAccountsStore.getState().client(account)).getPullRequest(projectPath, pr.number);
  if (full.commentCount !== undefined) commentCounts.set(key, { updatedAt: pr.updatedAt, count: full.commentCount });
  return { ...pr, commentCount: full.commentCount };
}

/**
 * Complète le nombre de commentaires des PR consultées qui ont changé depuis, pour distinguer un nouveau commentaire
 * d'une autre activité. Les autres PR n'en ont pas besoin : pas de requête pour elles. Une erreur laisse la PR telle quelle.
 */
export async function withCommentCounts<T extends ForgePR>(account: ForgeAccount, prs: T[], projectOf: (pr: T) => string): Promise<T[]> {
  if (account.provider !== "github") return prs;
  const { seen } = useSeenPrsStore.getState();
  return Promise.all(prs.map((pr) => {
    const freshness = prFreshness(seen[seenKey(account.id, projectOf(pr), pr.number)], pr);
    return freshness.kind === "updated" ? withCommentCount(account, projectOf(pr), pr).catch(() => pr) : pr;
  }));
}

/**
 * Liste des PR ouvertes à jour : complète leur nombre de commentaires et oublie les PR consultées qui ne sont plus
 * ouvertes. Si la liste est tronquée (une page pleine), une PR absente peut être simplement au-delà : rien n'est oublié.
 */
async function openListLoaded(account: ForgeAccount, projectPath: string, listed: ForgePR[]): Promise<ForgePR[]> {
  if (listed.length < PR_PAGE_SIZE) {
    const open = new Set(listed.map((pr) => pr.number));
    useSeenPrsStore.getState().forgetClosed(account.id, projectPath, [...open]);
    const prefix = seenPrefix(account.id, projectPath);
    for (const key of commentCounts.keys()) {
      if (key.startsWith(prefix) && !open.has(Number(key.slice(prefix.length)))) commentCounts.delete(key);
    }
  }
  return withCommentCounts(account, listed, () => projectPath);
}

/** Marque une PR comme lue ; sur GitHub, avec son nombre de commentaires pour repérer les prochains. */
export async function markPullRequestRead(account: ForgeAccount, projectPath: string, pr: ForgePR) {
  const full = account.provider === "github" ? await withCommentCount(account, projectPath, pr).catch(() => pr) : pr;
  useSeenPrsStore.getState().markSeen(seenKey(account.id, projectPath, pr.number), full);
}

/**
 * Recharge les PR ouvertes d'un projet dans le cache et met à jour les listes affichées.
 * Renvoie les PR ouvertes connues avant (null si jamais chargées) et après.
 */
export async function refreshOpenPullRequests(account: ForgeAccount, projectPath: string) {
  const key = `${account.id}|${projectPath}|open`;
  const before = cache.get(key)?.open ?? null;
  const listed = await (await useAccountsStore.getState().client(account)).getPullRequests(projectPath, "open");
  const open = await openListLoaded(account, projectPath, listed);
  cache.set(key, { open, filtered: open });
  listeners.forEach((l) => l());
  return { before, after: open };
}

/** PR ouvertes du projet déjà en cache, sans les charger : celles que la liste du dépôt a chargées. */
export function useCachedOpenPullRequests(forge: LinkedForge | null): ForgePR[] {
  const [, refreshed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(refreshed);
    return () => {
      listeners.delete(refreshed);
    };
  }, []);
  return forge ? cache.get(`${forge.account.id}|${forge.projectPath}|open`)?.open ?? [] : [];
}

/**
 * PR / MR du projet, filtrées par état (côté forge) et par personne (localement). Les données en cache sont
 * affichées tout de suite et actualisées en arrière-plan ; `loading` n'est vrai qu'au premier chargement.
 */
export function usePullRequests(forge: LinkedForge | null) {
  const client = useAccountsStore((s) => s.client);
  const [state, setState] = useState<PullRequestState>("open");
  const [scope, setScope] = useState<PrScope>("all");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refreshed] = useReducer((n: number) => n + 1, 0);
  const account = forge?.account;
  const projectPath = forge?.projectPath;
  const key = account && projectPath ? `${account.id}|${projectPath}|${state}` : null;
  const entry = key ? cache.get(key) : undefined;
  const openEntry = account && projectPath ? cache.get(`${account.id}|${projectPath}|open`) : undefined;

  const reload = useCallback(async () => {
    if (!account || !projectPath || !key) return;
    setFetching(true);
    setError(null);
    try {
      const c = await client(account);
      const [listed, filtered] = await Promise.all([
        c.getPullRequests(projectPath, "open"),
        state === "open" ? null : c.getPullRequests(projectPath, state),
      ]);
      const open = await openListLoaded(account, projectPath, listed);
      cache.set(key, { open, filtered: filtered ?? open });
      // Les badges lisent les PR ouvertes : le cache du filtre « ouvertes » suit aussi.
      cache.set(`${account.id}|${projectPath}|open`, { open, filtered: open });
      // Les autres lecteurs du cache (panneau de commit) suivent aussi.
      listeners.forEach((l) => l());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFetching(false);
    }
  }, [account, projectPath, key, state, client]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listeners.add(refreshed);
    return () => {
      listeners.delete(refreshed);
    };
  }, []);

  const prs = entry?.filtered ?? [];
  const visible = account ? prs.filter((pr) => matchesScope(pr, scope, account.username)) : [];
  return {
    prs: visible,
    /** PR ouvertes, quel que soit le filtre : badges des branches. */
    openPrs: openEntry?.open ?? [],
    loading: fetching && !entry,
    error,
    reload,
    state,
    setState,
    scope,
    setScope,
  };
}

export type PullRequestsState = ReturnType<typeof usePullRequests>;

const filterClass = "flex-1 min-w-0 bg-shade/30 border border-overlay/50 rounded px-1 py-0.5 text-[10px] text-[var(--color-text)] outline-none";

/** Filtres, lignes de PR / MR et panneau de revue. `indent` aligne les lignes sur celles de la barre latérale. */
export function PullRequestList({ forge, list, indent = 12 }: { forge: LinkedForge; list: PullRequestsState; indent?: number }) {
  const [reviewing, setReviewing] = useState<number | null>(null);
  const { menu, open, close } = useContextMenu();
  const seen = useSeenPrsStore((s) => s.seen);
  const { markUnread } = useSeenPrsStore.getState();
  const { account, projectPath, remoteName } = forge;
  const prLabel = account.provider === "gitlab" ? "MR" : "PR";
  const keyOf = (pr: ForgePR) => seenKey(account.id, projectPath, pr.number);
  const freshnessOf = (pr: ForgePR) => prFreshness(seen[keyOf(pr)], pr);

  const checkoutPr = (pr: ForgePR) => checkoutPullRequest(remoteName, pr);

  return (
    <>
      <div className="flex gap-1 pr-2 pb-1" style={{ paddingLeft: indent - 4 }}>
        <select
          className={filterClass}
          value={list.state}
          onChange={(e) => list.setState(e.target.value as PullRequestState)}
          aria-label={`État des ${prLabel}s`}
        >
          <option value="open">Ouvertes</option>
          <option value="merged">Mergées</option>
          <option value="closed">Fermées</option>
          <option value="all">Toutes</option>
        </select>
        <select
          className={filterClass}
          value={list.scope}
          onChange={(e) => list.setScope(e.target.value as PrScope)}
          aria-label={`Filtrer les ${prLabel}s`}
        >
          <option value="all">Tout le monde</option>
          <option value="mine">Les miennes</option>
          <option value="review">À relire par moi</option>
          <option value="assigned">Assignées à moi</option>
        </select>
      </div>
      {list.loading && <p className="py-1 text-xs text-[var(--color-muted)]" style={{ paddingLeft: indent }}>Chargement…</p>}
      {list.error && <p className="pr-3 py-1 text-xs text-red-400 break-words" style={{ paddingLeft: indent }}>{list.error}</p>}
      {!list.loading && !list.error && (
        <>
          {list.prs.map((pr) => {
            const freshness = freshnessOf(pr);
            return (
              <PRRow
                key={pr.number}
                pr={pr}
                freshness={freshness}
                approved={pr.approved}
                typeLabel={prLabel}
                indent={indent}
                onClick={() => setReviewing(pr.number)}
                onContextMenu={(e) => open(e, [
                  { label: "Voir le détail…", action: () => setReviewing(pr.number) },
                  { label: `Checkout ${pr.sourceBranch}`, action: () => checkoutPr(pr) },
                  { label: "Ouvrir dans le navigateur", action: () => openUrl(pr.url) },
                  freshness.kind === "read"
                    ? { label: "Marquer comme non lue", action: () => markUnread(keyOf(pr)) }
                    : { label: "Marquer comme lue", action: () => markPullRequestRead(account, projectPath, pr) },
                  { label: "Tout marquer comme lu", action: () => list.prs.forEach((p) => markPullRequestRead(account, projectPath, p)) },
                ])}
              />
            );
          })}
          {list.prs.length === 0 && (
            <p className="py-1 text-xs text-[var(--color-muted)] italic" style={{ paddingLeft: indent }}>Aucune {prLabel} pour ce filtre</p>
          )}
        </>
      )}
      {menu && <ContextMenu menu={menu} onClose={close} />}
      {reviewing !== null && (
        <PullRequestReviewDialog
          account={account}
          projectPath={projectPath}
          remoteName={remoteName}
          number={reviewing}
          onCheckout={checkoutPr}
          onChanged={list.reload}
          onClose={() => setReviewing(null)}
        />
      )}
    </>
  );
}

/** État d'une PR : une icône de forme différente par état, en plus de la couleur (RGAA 3.1). */
const PR_STATE_ICONS: Record<ForgePR["state"], { icon: LucideIcon; label: string }> = {
  open: { icon: GitPullRequestArrow, label: "ouverte" },
  merged: { icon: GitMerge, label: "mergée" },
  closed: { icon: GitPullRequestClosed, label: "fermée" },
};

const PR_STATE_COLORS: Record<ForgePR["state"], string> = {
  open: "text-green-400",
  merged: "text-purple-400",
  closed: "text-red-400",
};

/** Étiquettes des changements depuis la dernière consultation. */
export function FreshnessTags({ freshness }: { freshness: PrFreshness }) {
  if (freshness.kind === "unread") {
    return (
      <>
        <span className="w-1.5 h-1.5 mt-1 rounded-full bg-sky-400 shrink-0" title="Non lue" aria-hidden />
        <span className="sr-only">, non lue</span>
      </>
    );
  }
  if (freshness.kind !== "updated") return null;
  const tag = "inline-flex items-center gap-0.5 text-[9px] px-1 rounded border border-amber-400/40 text-amber-300 shrink-0";
  return (
    <>
      {freshness.commits && (
        <span className={tag} title="Nouveaux commits depuis ta dernière consultation">
          <GitCommitHorizontal size={10} /> <span className="sr-only">, nouveaux</span> commits
        </span>
      )}
      {freshness.comments && (
        <span className={tag} title="Nouveaux commentaires depuis ta dernière consultation">
          <MessageSquare size={10} /> <span className="sr-only">, nouveaux</span> commentaires
        </span>
      )}
      {!freshness.commits && !freshness.comments && (
        <span className={tag} title="Nouvelle activité (commentaire, relecture, label…) depuis ta dernière consultation">
          <span className="sr-only">, nouvelle </span>activité
        </span>
      )}
    </>
  );
}

/**
 * Ligne d'une PR / MR. `subtitle` remplace la ligne de détail par défaut ; `meta` s'affiche en dessous
 * (dans la barre latérale étroite, des badges à droite écraseraient le titre).
 */
export function PRRow({ pr, freshness, approved, typeLabel, indent, onClick, onContextMenu, subtitle, hint, meta }: {
  pr: ForgePR;
  freshness: PrFreshness;
  /** Relecture approuvée : libellé à côté du titre. */
  approved?: boolean;
  typeLabel: string;
  indent: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  subtitle?: string;
  hint?: string;
  meta?: React.ReactNode;
}) {
  const state = PR_STATE_ICONS[pr.state];
  return (
    // Entrée ou Espace : détail ; touche Menu ou Maj+F10 : menu (comme le clic droit).
    <div
      role="button"
      tabIndex={0}
      className="pr-3 py-1.5 hover:bg-overlay/5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/60"
      style={{ paddingLeft: indent }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }}
      onContextMenu={onContextMenu}
      title={hint ?? "Clic : voir le détail · Clic droit : checkout, navigateur"}
    >
      <div className="flex items-start gap-2">
        <state.icon size={12} strokeWidth={2} className={`${PR_STATE_COLORS[pr.state]} shrink-0 mt-0.5`} aria-hidden />
        <span className="sr-only">{typeLabel} {state.label} : </span>
        <div className="flex-1 min-w-0">
          <p
            className={`text-xs truncate ${
              freshness.kind === "read" ? "text-[var(--color-muted)]" : "text-[var(--color-text)] font-semibold"
            }`}
          >
            {pr.title}
          </p>
          <p className="text-[10px] text-[var(--color-muted)] truncate">
            {subtitle ?? `${typeLabel}#${pr.number} · ${pr.author} · ${pr.sourceBranch} → ${pr.targetBranch}`}
          </p>
          {meta && <div className="mt-1 flex flex-wrap items-center gap-1">{meta}</div>}
        </div>
        <FreshnessTags freshness={freshness} />
        {approved && (
          <span className={`text-[9px] px-1 rounded border shrink-0 ${MY_PR_STATUSES.approved.className}`}>{MY_PR_STATUSES.approved.label}</span>
        )}
        {pr.draft && <span className="text-[9px] border border-overlay/20 px-1 rounded text-[var(--color-muted)] shrink-0"><span className="sr-only">, </span>draft</span>}
      </div>
    </div>
  );
}
