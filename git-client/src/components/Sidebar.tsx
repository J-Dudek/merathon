import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRepoStore } from "../store/useRepoStore";
import { useAccountsStore } from "../store/useAccountsStore";
import { useUiStore, confirmAction, promptText } from "../store/useUiStore";
import {
  addRemote, checkoutBranch, checkoutCommit, checkoutRemoteBranch, createBranch, deleteBranch,
  deleteRemoteBranch, deleteRemoteTag, deleteTag, fetchRemote, lfsPull, lfsTrack, mergeBranch, pull, push, pushTag,
  openNewWindow, rebaseOnto, removeRemote, renameBranch, setUpstream, stashApply, stashDrop, updateSubmodules,
} from "../ipc/commands";
import { errorMessage, reportMerge, runGit } from "../lib/actions";
import { newPullRequestUrl, remoteForAccount } from "../lib/remoteUrl";
import { ContextMenu, useContextMenu, type MenuEntry } from "./ContextMenu";
import { openRepoAt } from "../lib/repoActions";
import { PullRequestDialog, type PullRequestTarget } from "./PullRequestDialog";
import { PullRequestList, checkoutPullRequest, useLinkedForge, usePullRequests } from "./PullRequestList";
import { prFreshness, seenKey, useSeenPrsStore } from "../store/useSeenPrsStore";
import { PullRequestReviewDialog } from "./PullRequestReviewDialog";
import { branchOnRemote, branchTree, flattenTree, localOnlyBranches, pullRequestsByBranch, type BranchNode } from "../lib/branches";
import { clickModifiers, clickSelection, EMPTY_SELECTION, pruneSelection, type MultiSelection } from "../lib/multiSelect";
import type { BranchInfo, StashInfo, SubmoduleInfo, TagInfo } from "../types/git";
import type { ForgePR } from "../types/forge";

const SUBMODULE_STATES: Record<SubmoduleInfo["state"], { label: string; color: string }> = {
  uninitialized: { label: "non initialisé", color: "text-amber-300" },
  commit_changed: { label: "autre commit", color: "text-sky-300" },
  dirty: { label: "modifié", color: "text-yellow-400" },
  ok: { label: "", color: "" },
};

function branchTitle(b: BranchInfo, localOnly: boolean): string {
  if (b.upstream) return `suit ${b.upstream}`;
  return localOnly ? "uniquement en local : absente des remotes" : "aucune branche distante suivie";
}

function submoduleTitle(sm: SubmoduleInfo): string {
  const recorded = sm.recorded_hash ? `commit enregistré : ${sm.recorded_hash.slice(0, 7)}` : null;
  return [sm.url ?? "", recorded].filter((line) => line !== null).join("\n");
}

function rowTone(active?: boolean, selected?: boolean): string {
  if (active) return "text-[var(--color-accent)] bg-overlay/5 font-semibold";
  if (selected) return "text-[var(--color-text)] bg-[var(--color-accent)]/20";
  return "text-[var(--color-text)] hover:bg-overlay/5";
}

export function Sidebar() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const info = useRepoStore((s) => s.info);
  const branches = useRepoStore((s) => s.branches);
  const tags = useRepoStore((s) => s.tags);
  const stashes = useRepoStore((s) => s.stashes);
  const remotes = useRepoStore((s) => s.remotes);
  const submodules = useRepoStore((s) => s.submodules);
  const lfs = useRepoStore((s) => s.lfs);
  const commits = useRepoStore((s) => s.commits);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);
  const accounts = useAccountsStore((s) => s.accounts);
  const busy = useUiStore((s) => s.busy);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  // Branches locales sélectionnées (Ctrl / Cmd + clic, Maj + clic pour une plage) pour les supprimer ensemble.
  const [selection, setSelection] = useState<MultiSelection>(EMPTY_SELECTION);
  const picked = selection.items;
  const clearPicked = () => setSelection((s) => ({ ...s, items: [] }));
  const [pullRequest, setPullRequest] = useState<PullRequestTarget | null>(null);
  const forge = useLinkedForge();
  const forgePrs = usePullRequests(forge);
  const seenPrs = useSeenPrsStore((s) => s.seen);
  /** PR ouverte depuis le badge d'une branche (le groupe des PR peut être replié). */
  const [badgeReview, setBadgeReview] = useState<number | null>(null);

  // Les branches supprimées ou renommées sortent de la sélection.
  useEffect(() => {
    const names = new Set(branches.filter((b) => !b.is_remote).map((b) => b.name));
    setSelection((s) => pruneSelection(s, (n) => names.has(n)));
  }, [branches]);

  if (!repoPath) return null;
  const path = repoPath;

  const local = branches.filter((b) => !b.is_remote);
  const localTree = branchTree(local, (b) => b.name);
  const remoteBranches = branches.filter((b) => b.is_remote);
  const localOnly = localOnlyBranches(branches);
  const head = info?.head_branch ?? "HEAD";
  const prsByBranch = pullRequestsByBranch(forgePrs.openPrs);
  const prsOf = (b: BranchInfo): ForgePR[] => {
    const name = forge && branchOnRemote(b, forge.remoteName);
    return name ? prsByBranch.get(name) ?? [] : [];
  };
  const prBadge = (b: BranchInfo) => {
    const prs = prsOf(b);
    if (!forge || !prs.length) return null;
    const fresh = prs.some((p) => prFreshness(seenPrs[seenKey(forge.account.id, forge.projectPath, p.number)], p).kind !== "read");
    return <PrBadge prs={prs} gitlab={forge.account.provider === "gitlab"} fresh={fresh} onOpen={setBadgeReview} />;
  };

  function selectHash(hash: string) {
    const commit = commits.find((c) => c.hash === hash);
    if (commit) setSelectedCommit(commit);
  }

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

  function handleLocalClick(e: React.MouseEvent, b: BranchInfo) {
    // Ordre visuel de l'arbre, pour que Maj + clic sélectionne la plage affichée.
    const order = flattenTree(localTree).map((l) => l.name);
    // La branche courante ne peut pas être supprimée : elle n'entre pas dans la sélection.
    const selectable = (name: string) => name !== info?.head_branch;
    const next = clickSelection(order, selection, b.name, clickModifiers(e), { selectable });
    setSelection(next.selection);
    if (next.plain) selectHash(b.target_hash);
  }

  async function deleteBranches(names: string[]) {
    const ui = useUiStore.getState();
    const n = names.length;
    if (!(await confirmAction(`Supprimer ${n} branches locales ?`, `${names.join(", ")}\n\nLes commits non mergés ailleurs ne seront plus référencés.`, true)))
      return;
    const failed: string[] = [];
    await runGit(async () => {
      for (const name of names) {
        await deleteBranch(path, name).catch((e) => failed.push(`${name} : ${errorMessage(e)}`));
      }
    }, { busy: "Suppression des branches…" });
    clearPicked();
    if (failed.length === 0) ui.notify("success", `${n} branches supprimées`);
    else ui.notify("error", `${n - failed.length}/${n} branches supprimées. Échec : ${failed.join(" ; ")}`);
  }

  function pickedMenu(names: string[]): MenuEntry[] {
    return [
      { label: `Supprimer les ${names.length} branches sélectionnées…`, danger: true, action: () => deleteBranches(names) },
      "separator",
      { label: "Annuler la sélection", action: clearPicked },
    ];
  }

  function localMenu(b: BranchInfo): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (!b.is_head) {
      entries.push(
        { label: "Checkout", action: () => runGit(() => checkoutBranch(path, b.name)) },
        {
          label: `Merger ${b.name} dans ${head}`,
          action: async () => reportMerge(await runGit(() => mergeBranch(path, b.name)), `Merge de ${b.name} terminé`),
        },
        {
          label: `Rebaser ${head} sur ${b.name}`,
          action: async () => reportMerge(await runGit(() => rebaseOnto(path, b.name)), `Rebase sur ${b.name} terminé`),
        },
      );
    } else if (b.upstream) {
      entries.push(
        { label: "Pull", action: async () => reportMerge(await runGit(() => pull(path, false), { busy: "Pull…" }), "Pull terminé") },
      );
    }
    entries.push(
      {
        label: b.upstream ? `Push vers ${b.upstream}` : "Push (publier la branche)",
        action: () => runGit(() => push(path, { branch: b.name }), { busy: "Push…", success: `Push de ${b.name} terminé` }),
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
      {
        label: "Checkout (branche locale de suivi)",
        action: () => runGit(() => checkoutRemoteBranch(path, b.name)),
      },
      {
        label: `Merger ${b.name} dans ${head}`,
        action: async () => reportMerge(await runGit(() => mergeBranch(path, b.name)), `Merge de ${b.name} terminé`),
      },
      {
        label: `Rebaser ${head} sur ${b.name}`,
        action: async () => reportMerge(await runGit(() => rebaseOnto(path, b.name)), `Rebase sur ${b.name} terminé`),
      },
      ...pullRequestEntries(b),
      "separator",
      { label: `Créer une branche depuis ${b.name}…`, action: () => newBranchFrom(b.name) },
      { label: "Copier le nom", action: () => navigator.clipboard.writeText(b.name) },
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

  function remoteGroupMenu(name: string): MenuEntry[] {
    return [
      { label: `Fetch ${name}`, action: () => runGit(() => fetchRemote(path, name), { busy: "Fetch…", success: "Fetch terminé" }) },
      { label: "Copier l'URL", action: () => navigator.clipboard.writeText(remotes.find((r) => r.name === name)?.url ?? "") },
      "separator",
      {
        label: "Supprimer le remote",
        danger: true,
        action: async () => {
          if (await confirmAction(`Supprimer le remote « ${name} » ?`, "Seule la configuration locale est supprimée.", true))
            await runGit(() => removeRemote(path, name));
        },
      },
    ];
  }

  async function handleAddRemote() {
    const name = await promptText("Nom du remote", { placeholder: "origin", initial: remotes.length ? "" : "origin" });
    if (!name) return;
    const url = await promptText(`URL du remote « ${name} »`, { placeholder: "https://… ou git@…" });
    if (url) await runGit(() => addRemote(path, name, url), { success: `Remote ${name} ajouté` });
  }

  function tagMenu(t: TagInfo): MenuEntry[] {
    const remoteNames = remotes.map((r) => r.name);
    return [
      { label: "Checkout (HEAD détaché)", action: () => runGit(() => checkoutCommit(path, t.name)) },
      { label: `Créer une branche depuis ${t.name}…`, action: () => newBranchFrom(t.name) },
      ...remoteNames.map((r) => ({
        label: `Push vers ${r}`,
        action: () => runGit(() => pushTag(path, r, t.name), { busy: "Push…", success: `Tag ${t.name} poussé` }),
      })),
      "separator" as const,
      {
        label: "Supprimer",
        danger: true,
        action: async () => {
          if (await confirmAction(`Supprimer le tag « ${t.name} » ?`, undefined, true)) await runGit(() => deleteTag(path, t.name));
        },
      },
      ...remoteNames.map((r) => ({
        label: `Supprimer sur ${r}`,
        danger: true,
        action: async () => {
          if (await confirmAction(`Supprimer le tag « ${t.name} » sur ${r} ?`, undefined, true))
            await runGit(() => deleteRemoteTag(path, r, t.name), { busy: "Suppression…" });
        },
      })),
    ];
  }

  function stashMenu(s: StashInfo): MenuEntry[] {
    return [
      { label: "Appliquer", action: () => runGit(() => stashApply(path, s.index, false), { success: "Stash appliqué" }) },
      { label: "Appliquer et supprimer (pop)", action: () => runGit(() => stashApply(path, s.index, true), { success: "Stash réappliqué" }) },
      "separator",
      {
        label: "Supprimer",
        danger: true,
        action: async () => {
          if (await confirmAction("Supprimer ce stash ?", s.message, true)) await runGit(() => stashDrop(path, s.index));
        },
      },
    ];
  }

  function submoduleMenu(sm: SubmoduleInfo): MenuEntry[] {
    const abs = `${path}/${sm.path}`;
    const initialized = sm.state !== "uninitialized";
    return [
      { label: "Ouvrir dans un nouvel onglet", disabled: !initialized, action: () => openRepoAt(abs) },
      { label: "Ouvrir dans une nouvelle fenêtre", disabled: !initialized, action: () => openNewWindow(abs) },
      "separator",
      {
        label: initialized ? "Mettre à jour (commit enregistré)" : "Initialiser et récupérer",
        action: () => runGit(() => updateSubmodules(path, [sm.name]), { busy: "Sous-module…", success: `${sm.name} à jour` }),
      },
      { label: "Copier l'URL", disabled: !sm.url, action: () => navigator.clipboard.writeText(sm.url ?? "") },
    ];
  }

  const remoteNames = Array.from(new Set([...remotes.map((r) => r.name), ...remoteBranches.map((b) => b.name.split("/")[0])]));

  return (
    <aside className="flex flex-col h-full bg-[var(--color-bg-secondary)] text-sm select-none overflow-y-auto py-1">
      <Group title="Local" count={local.length}>
        <BranchTree
          nodes={localTree}
          depth={0}
          renderBranch={(b, label, depth) => (
            <Row
              key={b.name}
              icon="⎇"
              label={label}
              depth={depth}
              active={b.is_head}
              selected={picked.includes(b.name)}
              title={`${b.name}\n${branchTitle(b, localOnly.has(b.name))}`}
              onClick={(e) => handleLocalClick(e, b)}
              onDoubleClick={() => !b.is_head && !busy && runGit(() => checkoutBranch(path, b.name))}
              onContextMenu={(e) => openMenu(e, picked.length > 1 && picked.includes(b.name) ? pickedMenu(picked) : localMenu(b))}
              trailing={
                <>
                  {prBadge(b)}
                  {localOnly.has(b.name) ? <LocalOnlyBadge /> : <AheadBehind ahead={b.ahead} behind={b.behind} />}
                </>
              }
            />
          )}
        />
      </Group>

      <Group
        title="Distant"
        count={remoteBranches.length}
        onAdd={handleAddRemote}
        addTitle="Ajouter un remote"
      >
        {remoteNames.map((name) => (
          <SubGroup key={name} title={name} onContextMenu={(e) => openMenu(e, remoteGroupMenu(name))}>
            <BranchTree
              nodes={branchTree(remoteBranches.filter((b) => b.name.startsWith(`${name}/`)), (b) => b.name.slice(name.length + 1))}
              depth={1}
              renderBranch={(b, label, depth) => (
                <Row
                  key={b.name}
                  icon="⟳"
                  label={label}
                  depth={depth}
                  title={b.name}
                  onClick={() => selectHash(b.target_hash)}
                  onDoubleClick={() => !busy && runGit(() => checkoutRemoteBranch(path, b.name))}
                  onContextMenu={(e) => openMenu(e, remoteMenu(b))}
                  trailing={prBadge(b)}
                />
              )}
            />
          </SubGroup>
        ))}
      </Group>

      {forge && (
        <Group
          title={forge.account.provider === "gitlab" ? "Merge requests" : "Pull requests"}
          count={forgePrs.prs.length}
          onAdd={forgePrs.reload}
          addTitle={`Rafraîchir (${forge.projectPath})`}
          addLabel="↻"
        >
          <li><PullRequestList forge={forge} list={forgePrs} indent={24} /></li>
        </Group>
      )}
      {forge && badgeReview !== null && (
        <PullRequestReviewDialog
          account={forge.account}
          projectPath={forge.projectPath}
          remoteName={forge.remoteName}
          number={badgeReview}
          onCheckout={(pr) => checkoutPullRequest(forge.remoteName, pr)}
          onChanged={forgePrs.reload}
          onClose={() => setBadgeReview(null)}
        />
      )}

      <Group title="Tags" count={tags.length} defaultOpen={false}>
        {tags.map((t) => (
          <Row
            key={t.name}
            icon="⌂"
            label={t.name}
            title={t.message ?? undefined}
            onClick={() => selectHash(t.target_hash)}
            onContextMenu={(e) => openMenu(e, tagMenu(t))}
          />
        ))}
      </Group>

      {submodules.length > 0 && (
        <Group
          title="Sous-modules"
          count={submodules.length}
          onAdd={() => runGit(() => updateSubmodules(path), { busy: "Sous-modules…", success: "Sous-modules à jour" })}
          addTitle="Initialiser et mettre à jour tous les sous-modules"
          addLabel="⟳"
        >
          {submodules.map((sm) => {
            const state = SUBMODULE_STATES[sm.state];
            return (
              <Row
                key={sm.name}
                icon="▣"
                label={sm.path}
                title={submoduleTitle(sm)}
                onDoubleClick={() => sm.state !== "uninitialized" && openRepoAt(`${path}/${sm.path}`)}
                onContextMenu={(e) => openMenu(e, submoduleMenu(sm))}
                trailing={state.label && <span className={`text-[10px] shrink-0 ${state.color}`}>{state.label}</span>}
              />
            );
          })}
        </Group>
      )}

      {lfs?.uses_lfs && (
        <Group
          title="LFS"
          count={lfs.files.length}
          defaultOpen={!lfs.version || lfs.files.some((f) => !f.downloaded)}
          onAdd={async () => {
            const pattern = await promptText("Suivre avec Git LFS", { placeholder: "*.psd", message: "Motif de fichiers (ajouté à .gitattributes)" });
            if (pattern) await runGit(() => lfsTrack(path, pattern), { success: `${pattern} suivi avec LFS` });
          }}
          addTitle="Suivre un motif avec LFS"
        >
          {!lfs.version ? (
            <li className="px-6 py-1 text-[11px] text-amber-300">
              git-lfs n'est pas installé : les fichiers LFS ne peuvent être ni récupérés ni poussés.
            </li>
          ) : (
            <>
              {lfs.files.some((f) => !f.downloaded) && (
                <li className="px-6 py-1 flex items-center gap-2 text-[11px] text-amber-300">
                  {lfs.files.filter((f) => !f.downloaded).length} fichier(s) non téléchargé(s)
                  <button
                    className="ml-auto px-1.5 rounded bg-overlay/10 hover:bg-overlay/15 text-[var(--color-text)]"
                    onClick={() => runGit(() => lfsPull(path), { busy: "LFS…", success: "Fichiers LFS récupérés" })}
                  >
                    Récupérer
                  </button>
                </li>
              )}
              {lfs.patterns.map((p) => (
                <Row
                  key={p}
                  icon="◆"
                  label={p}
                  title="Motif suivi par Git LFS"
                  onContextMenu={(e) => openMenu(e, [
                    { label: "Ne plus suivre avec LFS", action: () => runGit(() => lfsTrack(path, p, true)) },
                    { label: "Récupérer les fichiers LFS", action: () => runGit(() => lfsPull(path), { busy: "LFS…", success: "Fichiers LFS récupérés" }) },
                  ])}
                />
              ))}
            </>
          )}
        </Group>
      )}

      <Group title="Stashes" count={stashes.length}>
        {stashes.map((s) => (
          <Row
            key={s.hash}
            icon="⊟"
            label={s.message.replace(/^On [^:]+: /, "")}
            title={s.message}
            onDoubleClick={() => runGit(() => stashApply(path, s.index, false), { success: "Stash appliqué" })}
            onContextMenu={(e) => openMenu(e, stashMenu(s))}
          />
        ))}
      </Group>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {pullRequest && <PullRequestDialog target={pullRequest} onClose={() => setPullRequest(null)} />}
    </aside>
  );
}

function Group({ title, count, children, defaultOpen = true, onAdd, addTitle, addLabel = "+" }: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onAdd?: () => void;
  addTitle?: string;
  addLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <div className="flex items-center group">
        <button
          className="flex-1 flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] hover:text-[var(--color-text)]"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="w-2">{open ? "▾" : "▸"}</span>
          {title}
          <span className="ml-1 font-normal opacity-60">{count}</span>
        </button>
        {onAdd && (
          <button
            className="px-2 text-[var(--color-muted)] hover:text-[var(--color-text)] opacity-0 group-hover:opacity-100"
            title={addTitle}
            onClick={onAdd}
          >
            {addLabel}
          </button>
        )}
      </div>
      {open && (count > 0 || !!onAdd ? <ul>{children}</ul> : <p className="px-6 py-0.5 text-[11px] text-[var(--color-muted)] italic">aucun</p>)}
    </div>
  );
}

function SubGroup({ title, children, onContextMenu }: {
  title: string;
  children: React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button
        className="w-full flex items-center gap-1 px-4 py-[3px] text-xs text-[var(--color-text)] hover:bg-overlay/5"
        onClick={() => setOpen((v) => !v)}
        onContextMenu={onContextMenu}
      >
        <span className="w-2 text-[9px] text-[var(--color-muted)]">{open ? "▾" : "▸"}</span>
        <span className="opacity-60">☁</span>
        {title}
      </button>
      {open && <ul>{children}</ul>}
    </li>
  );
}

/** Arbre de branches : un dossier pliable par préfixe « xxx/ », récursivement. */
function BranchTree({ nodes, depth, renderBranch }: {
  nodes: BranchNode<BranchInfo>[];
  depth: number;
  renderBranch: (branch: BranchInfo, label: string, depth: number) => React.ReactNode;
}) {
  return nodes.map((node) =>
    node.kind === "branch" ? (
      renderBranch(node.item, node.name, depth)
    ) : (
      <BranchFolder key={`folder:${node.path}`} name={node.name} count={node.count} depth={depth}>
        <BranchTree nodes={node.children} depth={depth + 1} renderBranch={renderBranch} />
      </BranchFolder>
    ),
  );
}

function BranchFolder({ name, count, depth, children }: {
  name: string;
  count: number;
  depth: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button
        className="w-full flex items-center gap-1 pr-2 py-[3px] text-xs text-[var(--color-text)] hover:bg-overlay/5"
        style={{ paddingLeft: rowPadding(depth) - 12 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-2 text-[9px] text-[var(--color-muted)]">{open ? "▾" : "▸"}</span>
        <span className="truncate">{name}</span>
        <span className="ml-1 text-[10px] opacity-50">{count}</span>
      </button>
      {open && <ul>{children}</ul>}
    </li>
  );
}

/** Retrait gauche (px) d'une ligne selon sa profondeur dans l'arbre. */
function rowPadding(depth: number): number {
  return 24 + depth * 12;
}

function Row({ icon, label, active, selected, depth = 0, title, trailing, onClick, onDoubleClick, onContextMenu }: {
  icon: string;
  label: string;
  active?: boolean;
  /** Fait partie d'une sélection multiple. */
  selected?: boolean;
  /** Profondeur dans l'arbre (dossiers de branches, remotes). */
  depth?: number;
  title?: string;
  trailing?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <li>
      <div
        title={title}
        className={`flex items-center gap-2 pr-2 py-[3px] cursor-default ${rowTone(active, selected)}`}
        style={{ paddingLeft: rowPadding(depth) }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <span className="shrink-0 opacity-50 text-xs">{icon}</span>
        <span className="truncate text-xs flex-1">{label}</span>
        {trailing}
      </div>
    </li>
  );
}

/** PR / MR ouvertes depuis la branche : clic pour ouvrir le détail de la première. */
/** `fresh` : une des PR n'a pas été lue ou a changé depuis sa consultation. */
function PrBadge({ prs, gitlab, fresh, onOpen }: { prs: ForgePR[]; gitlab: boolean; fresh: boolean; onOpen: (n: number) => void }) {
  const sign = gitlab ? "!" : "#";
  const first = prs[0];
  const title = prs.map((p) => `${sign}${p.number} ${p.title} → ${p.targetBranch}${p.draft ? " (brouillon)" : ""}`).join("\n");
  return (
    <button
      className={`relative shrink-0 px-1 text-[9px] font-mono rounded border ${
        first.draft ? "border-overlay/20 text-[var(--color-muted)]" : "border-green-500/50 text-green-300"
      } hover:bg-overlay/10`}
      title={`${title}${fresh ? "\nNon lue ou modifiée depuis ta dernière consultation" : ""}\nClic : voir le détail`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(first.number);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {gitlab ? "MR" : "PR"} {sign}{first.number}{prs.length > 1 ? ` +${prs.length - 1}` : ""}
      {fresh && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-sky-400" />}
    </button>
  );
}

function LocalOnlyBadge() {
  return (
    <span className="shrink-0 px-1 text-[9px] italic rounded border border-dashed border-[var(--color-accent)]/50 text-[var(--color-accent)]">
      local
    </span>
  );
}

function AheadBehind({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind) return null;
  return (
    <span className="shrink-0 text-[10px] font-mono text-[var(--color-muted)]" title={`${ahead} en avance, ${behind} en retard`}>
      {ahead > 0 && <span>↑{ahead}</span>}
      {behind > 0 && <span className="ml-0.5">↓{behind}</span>}
    </span>
  );
}
