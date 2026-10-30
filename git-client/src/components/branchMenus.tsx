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
import { ancestorsOf, canFastForward } from "../lib/ancestry";
import { branchKey } from "../lib/graphFilter";
import { useGraphFilterStore } from "../store/useGraphFilterStore";
import { newPullRequestUrl, remoteForAccount } from "../lib/remoteUrl";
import { PullRequestDialog, type PullRequestTarget } from "./PullRequestDialog";
import type { MenuEntry } from "./ContextMenu";
import type { BranchInfo } from "../types/git";

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
      const noun = github ? "pull request" : "merge request";
      entries.push(
        {
          label: `Créer une ${noun} ${forge}…`,
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
        { label: `Ouvrir la création de ${noun} sur ${forge}`, action: () => openUrl(newPullRequestUrl(account, match.path, source)) },
      );
    }
    return entries;
  }

  async function newBranchFrom(from: string) {
    const result = await useUiStore.getState().ask({
      title: "Nouvelle branche",
      message: `Depuis ${from}`,
      input: { placeholder: "nom-de-branche" },
      checkbox: { label: "Basculer sur la nouvelle branche", initial: true },
      confirmLabel: "Créer",
    });
    const name = result?.value.trim();
    if (name) await runGit(() => createBranch(path, name, from, result!.checked), { success: `Branche ${name} créée` });
  }

  /**
   * Checkout, merge, rebase et fast-forward d'une autre branche que la branche courante.
   * Merge et rebase sont désactivés si la branche est déjà contenue dans la branche courante : ils ne feraient rien.
   */
  function branchActions(b: BranchInfo): MenuEntry[] {
    const inHead = !!info?.head_hash && ancestorsOf(commits, info.head_hash).has(b.target_hash);
    const inHeadHint = inHead ? `Déjà dans ${head}` : undefined;
    const entries: MenuEntry[] = [
      b.is_remote
        ? { label: "Checkout (branche locale de suivi)", action: () => runGit(() => checkoutRemoteBranch(path, b.name)) }
        : { label: `Checkout ${b.name}`, action: () => runGit(() => checkoutBranch(path, b.name)) },
      {
        label: `Merger ${b.name} dans ${head}`,
        disabled: inHead,
        hint: inHeadHint,
        action: async () => reportMerge(await runGit(() => mergeBranch(path, b.name)), `Merge de ${b.name} terminé`),
      },
      {
        label: `Rebaser ${head} sur ${b.name}`,
        disabled: inHead,
        hint: inHeadHint,
        action: async () => reportMerge(await runGit(() => rebaseOnto(path, b.name)), `Rebase sur ${b.name} terminé`),
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
        label: `Fast-forward ${current} jusqu'à ${b.name}`,
        hint: "Avance la branche courante, sans commit de merge",
        action: () => runGit(() => fastForward(path, b.name), { success: `${current} avancée jusqu'à ${b.name}` }),
      });
    }
    if (b.is_remote || b.is_head) return entries;
    const moveTo = (target: string) => ({
      label: `Fast-forward ${b.name} jusqu'à ${target}`,
      hint: "Avance cette branche sans la checkout",
      action: () => runGit(() => fastForwardBranch(path, b.name, target), { success: `${b.name} avancée jusqu'à ${target}` }),
    });
    if (current && canFastForward(commits, b.target_hash, info?.head_hash)) entries.push(moveTo(current));
    const upstream = b.upstream ? branches.find((r) => r.is_remote && r.name === b.upstream) : undefined;
    if (upstream && upstream.target_hash !== info?.head_hash && canFastForward(commits, b.target_hash, upstream.target_hash))
      entries.push(moveTo(upstream.name));
    return entries;
  }

  function localMenu(b: BranchInfo): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (!b.is_head) {
      entries.push(...branchActions(b));
    } else if (b.upstream) {
      entries.push(
        { label: "Pull", action: async () => reportMerge(await runGit(() => pull(path, false), { busy: "Pull…" }), "Pull terminé") },
      );
    }
    entries.push(
      {
        label: b.upstream ? `Push vers ${b.upstream}` : "Push (publier la branche)",
        action: () => pushBranch(path, b.name, { success: `Push de ${b.name} terminé` }),
      },
      ...pullRequestEntries(b),
      "separator",
      { label: `Créer une branche depuis ${b.name}…`, action: () => newBranchFrom(b.name) },
      {
        label: "Renommer…",
        action: async () => {
          const name = await promptText("Renommer la branche", { initial: b.name });
          if (name && name !== b.name) await runGit(() => renameBranch(path, b.name, name));
        },
      },
      {
        label: "Définir la branche suivie…",
        action: async () => {
          const upstream = await promptText("Branche distante suivie", {
            initial: b.upstream ?? `origin/${b.name}`,
            placeholder: "origin/branche",
          });
          if (upstream) await runGit(() => setUpstream(path, b.name, upstream));
        },
      },
      ...(b.upstream
        ? [{ label: "Ne plus suivre de branche distante", action: () => runGit(() => setUpstream(path, b.name, null)) }]
        : []),
      { label: "Copier le nom", action: () => navigator.clipboard.writeText(b.name) },
      "separator",
      ...graphEntries(b),
      "separator",
      {
        label: "Supprimer",
        danger: true,
        disabled: b.is_head,
        action: async () => {
          if (await confirmAction(`Supprimer la branche « ${b.name} » ?`, "Les commits non mergés ailleurs ne seront plus référencés.", true))
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
      { label: `Créer une branche depuis ${b.name}…`, action: () => newBranchFrom(b.name) },
      { label: "Copier le nom", action: () => navigator.clipboard.writeText(b.name) },
      "separator",
      ...graphEntries(b),
      "separator",
      {
        label: "Supprimer la branche distante",
        danger: true,
        action: async () => {
          if (await confirmAction(`Supprimer « ${b.name} » sur le serveur ?`, undefined, true))
            await runGit(() => deleteRemoteBranch(path, b.name), { busy: "Suppression…", success: `${b.name} supprimée` });
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
        label: solo ? "Quitter le solo" : "Solo : n'afficher que cette branche",
        hint: solo ? undefined : "Cumulable avec d'autres branches en solo",
        action: () => toggleSolo(path, key),
      },
      {
        label: hidden ? "Réafficher dans le graphe" : "Masquer dans le graphe",
        disabled: b.is_head && !hidden,
        hint: b.is_head && !hidden ? "Impossible pour la branche courante" : undefined,
        action: () => toggleHidden(path, key),
      },
    ];
  }

  const dialog = pullRequest && <PullRequestDialog target={pullRequest} onClose={() => setPullRequest(null)} />;
  return { localMenu, remoteMenu, branchActions, newBranchFrom, dialog };
}
