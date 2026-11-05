import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRepoStore } from "../store/useRepoStore";
import { useAccountsStore } from "../store/useAccountsStore";
import { useUiStore, confirmAction, promptText } from "../store/useUiStore";
import {
  checkoutBranch, checkoutRemoteBranch, createBranch, deleteBranch, deleteRemoteBranch, fastForward, fastForwardBranch, mergeBranch, pull,
  rebaseOnto, renameBranch, setUpstream,
} from "../ipc/commands";
import { reportMerge, runGit } from "../lib/actions";
import { pushBranch } from "../lib/threadReplies";
import { createWorktree } from "../lib/worktrees";
import { openRepoAt } from "../lib/repoActions";
import { ancestorsOf, canFastForward } from "../lib/ancestry";
import { branchKey } from "../lib/graphFilter";
import { useGraphFilterStore } from "../store/useGraphFilterStore";
import { newPullRequestUrl, remoteForAccount } from "../lib/remoteUrl";
import { PullRequestDialog, type PullRequestTarget } from "./PullRequestDialog";
import type { MenuEntry } from "./ContextMenu";
import type { BranchInfo } from "../types/git";
import { tr } from "../i18n";

/**
 * Menus d'une branche locale ou distante, communs à la barre latérale et au graphe des commits.
 * `dialog` (création de PR / MR) est à afficher par le composant qui utilise les menus.
 */
export function useBranchMenus() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const info = useRepoStore((s) => s.info);
  const remotes = useRepoStore((s) => s.remotes);
  const commits = useRepoStore((s) => s.commits);
  const branches = useRepoStore((s) => s.branches);
  const accounts = useAccountsStore((s) => s.accounts);
  const worktrees = useRepoStore((s) => s.worktrees);
  const graphFilter = useGraphFilterStore((s) => (repoPath ? s.filters[repoPath] : undefined));
  const [pullRequest, setPullRequest] = useState<PullRequestTarget | null>(null);
  const path = repoPath ?? "";
  const head = info?.head_branch ?? "HEAD";

  /**
   * Création de PR (GitHub) / MR (GitLab) pour chaque compte dont l'instance héberge un remote du dépôt :
   * formulaire complet dans l'application, ou page de création dans le navigateur.
   * Branche locale : projet de sa branche suivie en priorité. Branche distante : projet de son remote.
   */
  function pullRequestEntries(b: BranchInfo): MenuEntry[] {
    const [remoteName, remoteBranch] = b.is_remote ? [b.name.slice(0, b.name.indexOf("/")), b.name.slice(b.name.indexOf("/") + 1)] : [];
    const upstreamRemote = b.upstream?.slice(0, b.upstream.indexOf("/"));
    const entries: MenuEntry[] = [];
    for (const account of accounts) {
      const candidates = b.is_remote ? remotes.filter((r) => r.name === remoteName) : remotes;
      const match = remoteForAccount(candidates, account, upstreamRemote);
      if (!match) continue;
      const remote = match.remote.name;
      // Nom de la branche sur le remote : celui de la branche suivie si elle est sur ce remote.
      const source = remoteBranch
        ?? (b.upstream?.startsWith(`${remote}/`) ? b.upstream.slice(remote.length + 1) : b.name);
      const github = account.provider === "github";
      const forge = github ? "GitHub" : "GitLab";
      const noun = github ? tr("pull request") : tr("merge request");
      entries.push(
        {
          label: tr("Créer une {noun} {forge}…", { noun, forge }),
          hint: match.path,
          action: () => setPullRequest({
            account,
            projectPath: match.path,
            remoteName: remote,
            sourceBranch: source,
            localBranch: b.is_remote ? undefined : b.name,
            needsPush: !b.is_remote && (!b.upstream?.startsWith(`${remote}/`) || b.ahead > 0),
          }),
        },
        { label: tr("Ouvrir la création de {noun} sur {forge}", { noun, forge }), action: () => openUrl(newPullRequestUrl(account, match.path, source)) },
      );
    }
    return entries;
  }

  /** Autre worktree où cette branche locale est extraite. */
  const elsewhere = (b: BranchInfo) => (b.is_remote ? undefined : worktrees.find((w) => !w.is_current && w.branch === b.name));

  async function newBranchFrom(from: string) {
    const result = await useUiStore.getState().ask({
      title: tr("Nouvelle branche"),
      message: tr("Depuis {from}", { from }),
      input: { placeholder: tr("nom-de-branche") },
      checkbox: { label: tr("Basculer sur la nouvelle branche"), initial: true },
      confirmLabel: tr("Créer"),
    });
    const name = result?.value.trim();
    if (name) await runGit(() => createBranch(path, name, from, result!.checked), { success: tr("Branche {name} créée", { name }) });
  }

  /**
   * Checkout, merge, rebase et fast-forward d'une autre branche que la branche courante.
   * Merge et rebase sont désactivés si la branche est déjà contenue dans la branche courante : ils ne feraient rien.
   */
  function branchActions(b: BranchInfo): MenuEntry[] {
    const inHead = !!info?.head_hash && ancestorsOf(commits, info.head_hash).has(b.target_hash);
    const inHeadHint = inHead ? tr("Déjà dans {head}", { head }) : undefined;
    const entries: MenuEntry[] = [
      b.is_remote
        ? { label: tr("Checkout (branche locale de suivi)"), action: () => runGit(() => checkoutRemoteBranch(path, b.name)) }
        : {
            label: `Checkout ${b.name}`,
            disabled: !!elsewhere(b),
            hint: elsewhere(b) && tr("Extraite dans un autre worktree"),
            action: () => runGit(() => checkoutBranch(path, b.name)),
          },
      {
        label: tr("Merger {name} dans {head}", { name: b.name, head }),
        disabled: inHead,
        hint: inHeadHint,
        action: async () => reportMerge(await runGit(() => mergeBranch(path, b.name)), tr("Merge de {name} terminé", { name: b.name })),
      },
      {
        label: tr("Rebaser {head} sur {name}", { head, name: b.name }),
        disabled: inHead,
        hint: inHeadHint,
        action: async () => reportMerge(await runGit(() => rebaseOnto(path, b.name)), tr("Rebase sur {name} terminé", { name: b.name })),
      },
    ];
    return [...entries, ...fastForwardEntries(b)];
  }

  /**
   * Fast-forward possibles autour d'une autre branche : la branche courante jusqu'à elle, elle jusqu'à la branche
   * courante (sans checkout), ou elle jusqu'à sa branche distante suivie (sans checkout).
   */
  function fastForwardEntries(b: BranchInfo): MenuEntry[] {
    const entries: MenuEntry[] = [];
    const current = info?.head_branch;
    if (current && canFastForward(commits, info?.head_hash, b.target_hash)) {
      entries.push({
        label: tr("Fast-forward {current} jusqu'à {name}", { current, name: b.name }),
        hint: tr("Avance la branche courante, sans commit de merge"),
        action: () => runGit(() => fastForward(path, b.name), { success: tr("{current} avancée jusqu'à {name}", { current, name: b.name }) }),
      });
    }
    if (b.is_remote || b.is_head || elsewhere(b)) return entries;
    const moveTo = (target: string) => ({
      label: tr("Fast-forward {name} jusqu'à {target}", { name: b.name, target }),
      hint: tr("Avance cette branche sans la checkout"),
      action: () => runGit(() => fastForwardBranch(path, b.name, target), { success: tr("{name} avancée jusqu'à {target}", { name: b.name, target }) }),
    });
    if (current && canFastForward(commits, b.target_hash, info?.head_hash)) entries.push(moveTo(current));
    const upstream = b.upstream ? branches.find((r) => r.is_remote && r.name === b.upstream) : undefined;
    if (upstream && upstream.target_hash !== info?.head_hash && canFastForward(commits, b.target_hash, upstream.target_hash))
      entries.push(moveTo(upstream.name));
    return entries;
  }

  /** Ouvre le worktree de la branche, ou l'extrait dans un nouveau. La branche courante est déjà affichée. */
  function worktreeEntries(b: BranchInfo): MenuEntry[] {
    if (b.is_head) return [];
    const other = elsewhere(b);
    return other
      ? [{ label: tr("Ouvrir son worktree"), hint: other.path, action: () => openRepoAt(other.path) }]
      : [{ label: tr("Extraire dans un nouveau worktree…"), action: () => createWorktree(b.name, false) }];
  }

  function localMenu(b: BranchInfo): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (!b.is_head) {
      entries.push(...branchActions(b));
    } else if (b.upstream) {
      entries.push(
        {
          label: "Pull",
          // Comme le bouton de la barre d'outils : pas de second pull tant qu'une opération réseau est en cours.
          disabled: !!useUiStore.getState().busy,
          action: async () => reportMerge(await runGit(() => pull(path, false), { busy: tr("Pull…") }), tr("Pull terminé")),
        },
      );
    }
    entries.push(
      {
        label: b.upstream ? tr("Push vers {upstream}", { upstream: b.upstream }) : tr("Push (publier la branche)"),
        action: () => pushBranch(path, b.name, { success: tr("Push de {name} terminé", { name: b.name }) }),
      },
      ...pullRequestEntries(b),
      "separator",
      { label: tr("Créer une branche depuis {name}…", { name: b.name }), action: () => newBranchFrom(b.name) },
      ...worktreeEntries(b),
      {
        label: tr("Renommer…"),
        action: async () => {
          const name = await promptText(tr("Renommer la branche"), { initial: b.name });
          if (name && name !== b.name) await runGit(() => renameBranch(path, b.name, name));
        },
      },
      {
        label: tr("Définir la branche suivie…"),
        action: async () => {
          const upstream = await promptText(tr("Branche distante suivie"), {
            initial: b.upstream ?? `origin/${b.name}`,
            placeholder: "origin/branche",
          });
          if (upstream) await runGit(() => setUpstream(path, b.name, upstream));
        },
      },
      ...(b.upstream
        ? [{ label: tr("Ne plus suivre de branche distante"), action: () => runGit(() => setUpstream(path, b.name, null)) }]
        : []),
      { label: tr("Copier le nom"), action: () => navigator.clipboard.writeText(b.name) },
      "separator",
      ...graphEntries(b),
      "separator",
      {
        label: tr("Supprimer"),
        danger: true,
        disabled: b.is_head || !!elsewhere(b),
        hint: elsewhere(b) && tr("Extraite dans un autre worktree"),
        action: async () => {
          if (await confirmAction(tr("Supprimer la branche « {name} » ?", { name: b.name }), tr("Les commits non mergés ailleurs ne seront plus référencés."), true))
            await runGit(() => deleteBranch(path, b.name));
        },
      },
    );
    return entries;
  }

  function remoteMenu(b: BranchInfo): MenuEntry[] {
    return [
      ...branchActions(b),
      ...pullRequestEntries(b),
      "separator",
      { label: tr("Créer une branche depuis {name}…", { name: b.name }), action: () => newBranchFrom(b.name) },
      { label: tr("Copier le nom"), action: () => navigator.clipboard.writeText(b.name) },
      "separator",
      ...graphEntries(b),
      "separator",
      {
        label: tr("Supprimer la branche distante"),
        danger: true,
        action: async () => {
          if (await confirmAction(tr("Supprimer « {name} » sur le serveur ?", { name: b.name }), undefined, true))
            await runGit(() => deleteRemoteBranch(path, b.name), { busy: tr("Suppression…"), success: tr("{name} supprimée", { name: b.name }) });
        },
      },
    ];
  }

  /** Solo (n'afficher que cette branche, cumulable) et masquage dans le graphe. */
  function graphEntries(b: BranchInfo): MenuEntry[] {
    const key = branchKey(b);
    const solo = graphFilter?.solo.includes(key) ?? false;
    const hidden = graphFilter?.hidden.includes(key) ?? false;
    const { toggleSolo, toggleHidden } = useGraphFilterStore.getState();
    return [
      {
        label: solo ? tr("Quitter le solo") : tr("Solo : n'afficher que cette branche"),
        hint: solo ? undefined : tr("Cumulable avec d'autres branches en solo"),
        action: () => toggleSolo(path, key),
      },
      {
        label: hidden ? tr("Réafficher dans le graphe") : tr("Masquer dans le graphe"),
        disabled: b.is_head && !hidden,
        hint: b.is_head && !hidden ? tr("Impossible pour la branche courante") : undefined,
        action: () => toggleHidden(path, key),
      },
    ];
  }

  const dialog = pullRequest && <PullRequestDialog target={pullRequest} onClose={() => setPullRequest(null)} />;
  return { localMenu, remoteMenu, branchActions, newBranchFrom, dialog };
}
