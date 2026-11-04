import { Cloud, GitBranch, Tag, type LucideIcon } from "lucide-react";
import { useRef, useState, useEffect, useMemo } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { MIN_GRAPH_WIDTH, useUiStore, confirmAction } from "../store/useUiStore";
import { computeGraphLayout } from "./layout";
import { filterCommits } from "../search/filterCommits";
import { GraphCanvas, H_PADDING, LANE_WIDTH } from "./GraphCanvas";
import { ROW_HEIGHTS, useDisplayStore } from "../store/useDisplayStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../components/ContextMenu";
import {
  checkoutCommit, cherryPick, createBranch, createTag, getCommitDetails, interactiveRebase, mergeBranch, rebaseOnto, rebaseTodo,
  resetTo, revertCommit, rewordHead,
} from "../ipc/commands";
import { errorMessage, reportInteractive, reportMerge, runGit } from "../lib/actions";
import { ancestorsOf } from "../lib/ancestry";
import { EMPTY_FILTER, effectiveFilter, filterGraph, type GraphFilter } from "../lib/graphFilter";
import { useGraphFilterStore } from "../store/useGraphFilterStore";
import { useBranchMenus } from "../components/branchMenus";
import { localOnlyBranches } from "../lib/branches";
import { squashPlan } from "../lib/squash";
import { draftFromMessage } from "../lib/threadTrailers";
import { clickModifiers, clickSelection, EMPTY_SELECTION, pruneSelection, type MultiSelection } from "../lib/multiSelect";
import { dispatchContextMenu, isContextMenuKey, listKeyIndex } from "../lib/keyboardContextMenu";
import type { BranchInfo, CommitInfo, MergeResult, RefLabel } from "../types/git";
import { resizeKeyDelta } from "../lib/resizeKeys";
import { tr, trn, locale } from "../i18n";

const INFO_OFFSET = 20;
const OVERSCAN = 10;

export function CommitGraph() {
  const commits = useRepoStore((s) => s.commits);
  const status = useRepoStore((s) => s.status);
  const info = useRepoStore((s) => s.info);
  const searchQuery = useRepoStore((s) => s.searchQuery);
  const selectedCommit = useRepoStore((s) => s.selectedCommit);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);
  const repoPath = useRepoStore((s) => s.repoPath);
  const branches = useRepoStore((s) => s.branches);
  const localOnly = useMemo(() => localOnlyBranches(branches), [branches]);
  const setComparison = useRepoStore((s) => s.setComparison);
  const { localMenu, remoteMenu, branchActions, dialog: pullRequestDialog } = useBranchMenus();
  // Commits déjà contenus dans la branche courante : cherry-pick, merge et rebase sur eux n'ont pas de sens.
  const headAncestors = useMemo(() => ancestorsOf(commits, info?.head_hash), [commits, info?.head_hash]);
  // Branches masquées ou en solo (menu d'une branche), puis recherche.
  const storedFilter = useGraphFilterStore((s) => (repoPath ? s.filters[repoPath] : undefined));
  const graphFilter = useMemo(() => effectiveFilter(storedFilter ?? EMPTY_FILTER, branches), [storedFilter, branches]);
  const shownCommits = useMemo(() => filterGraph(commits, graphFilter), [commits, graphFilter]);
  const visibleCommits = useMemo(() => filterCommits(shownCommits, searchQuery), [shownCommits, searchQuery]);
  // Le conteneur observé n'existe que s'il y a des commits à afficher.
  const hasCommits = visibleCommits.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 400 });
  const rowHeight = useDisplayStore((s) => ROW_HEIGHTS[s.density]);
  const [scrollTop, setScrollTop] = useState(0);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  // Sélection multiple (Ctrl / Cmd + clic, Maj + clic pour une plage), en plus du commit affiché dans le détail.
  const [selection, setSelection] = useState<MultiSelection>(EMPTY_SELECTION);
  const multi = selection.items;
  const clearMulti = () => setSelection((s) => ({ ...s, items: [] }));

  // Les commits réécrits ou disparus après un rafraîchissement sortent de la sélection.
  useEffect(() => {
    const hashes = new Set(commits.map((c) => c.hash));
    setSelection((s) => pruneSelection(s, (h) => hashes.has(h)));
  }, [commits]);

  // Commit sélectionné ailleurs (ex. clic sur une branche de la barre latérale) : on repart de lui.
  useEffect(() => {
    const hash = selectedCommit?.hash ?? null;
    setSelection((s) => (hash === s.anchor || (hash !== null && s.items.includes(hash)) ? s : { anchor: hash, items: [] }));
  }, [selectedCommit]);

  function selectOne(commit: CommitInfo | null) {
    setSelection({ anchor: commit?.hash ?? null, items: [] });
    setSelectedCommit(commit);
  }

  function handleRowClick(e: React.MouseEvent, commit: CommitInfo) {
    const order = layout.nodes.map((n) => n.commit.hash);
    const next = clickSelection(order, selection, commit.hash, clickModifiers(e), { current: selectedCommit?.hash ?? null });
    setSelection(next.selection);
    setSelectedCommit(commit);
  }

  // Clavier : flèches, Origine / Fin, Page préc. / suiv. ; touche Menu ou Maj+F10 pour le menu du commit sélectionné.
  function handleListKey(e: React.KeyboardEvent) {
    if (isContextMenuKey(e)) {
      const row = selectedCommit && document.getElementById(rowId(selectedCommit.hash));
      if (row) {
        e.preventDefault();
        dispatchContextMenu(row);
      }
      return;
    }
    const current = selectedCommit ? layout.nodes.findIndex((n) => n.commit.hash === selectedCommit.hash) : -1;
    const page = Math.max(1, Math.floor(size.height / rowHeight) - 1);
    const next = listKeyIndex(e.key, current, layout.nodes.length, page);
    if (next === null) return;
    e.preventDefault();
    selectOne(layout.nodes[next].commit);
  }

  async function squashSelected(hashes: string[]) {
    if (!repoPath) return;
    const path = repoPath;
    const ui = useUiStore.getState();
    const head = info?.head_branch ?? "HEAD";
    // Le graphe est trié topologiquement : le plus ancien des commits sélectionnés est le dernier.
    const selected = commits.filter((c) => hashes.includes(c.hash));
    const oldest = selected[selected.length - 1];
    const base = oldest?.parents[0];
    if (!base) {
      ui.notify("error", tr("Le premier commit du dépôt ne peut pas être squashé"));
      return;
    }
    const todo = await runGit(() => rebaseTodo(path, base), { refresh: false });
    if (!todo) return;
    const check = squashPlan(todo, hashes, "");
    if (typeof check === "string") {
      ui.notify("error", check);
      return;
    }

    const result = await ui.ask({
      title: tr("Squasher {length} commits sur {head}", { length: hashes.length, head }),
      message: tr("Ils seront fusionnés en un seul commit, à la place du plus ancien. L'historique de la branche sera réécrit."),
      input: { multiline: true, initial: check.commits.map((c) => c.message.trim()).join("\n\n") },
      confirmLabel: tr("Squasher"),
    });
    if (!result) return;
    const plan = squashPlan(todo, hashes, result.value);
    if (typeof plan === "string") return;

    clearMulti();
    const outcome = await runGit(() => interactiveRebase(path, base, plan.steps, plan.mode), { busy: tr("Squash…") });
    if (outcome && !outcome.stopped) ui.notify("success", tr("{length} commits squashés (ancienne position : ORIG_HEAD)", { length: hashes.length }));
    else reportInteractive(outcome);
  }

  /** Commits sélectionnés, du plus ancien au plus récent (le graphe est trié topologiquement, plus récent en haut). */
  function oldestFirst(hashes: string[]): CommitInfo[] {
    return commits.filter((c) => hashes.includes(c.hash)).reverse();
  }

  async function cherryPickSelected(hashes: string[]) {
    if (!repoPath) return;
    const path = repoPath;
    const ui = useUiStore.getState();
    const head = info?.head_branch ?? "HEAD";
    const picked = oldestFirst(hashes);
    let done = 0;
    let stopped: MergeResult | undefined;
    const ok = await runGit(async () => {
      for (const c of picked) {
        const result = await cherryPick(path, c.hash).catch((e) => {
          throw new Error(tr("{error} ({short_hash} ; {done}/{length} commits appliqués)", { error: errorMessage(e), short_hash: c.short_hash, done, length: picked.length }));
        });
        if (!result.success) {
          stopped = result;
          break;
        }
        done++;
      }
      return true;
    }, { busy: "Cherry-pick…" });
    clearMulti();
    if (!ok) return;
    if (!stopped) {
      ui.notify("success", tr("{length} commits cherry-pickés dans {head}", { length: picked.length, head }));
      return;
    }
    // Comme reportMerge : le panneau de droite affiche les fichiers en conflit à résoudre.
    setSelectedCommit(null);
    const rest = picked.slice(done + 1).map((c) => c.short_hash);
    ui.notify(
      "info",
      tr("Conflit en appliquant {short_hash} ({done}/{length} déjà appliqués).", { short_hash: picked[done].short_hash, done, length: picked.length }) +
        (rest.length ? tr(" Restent à cherry-picker après résolution : {list}.", { list: rest.join(", ") }) : ""),
    );
  }

  function compareSelected(hashes: string[]) {
    const [base, head] = oldestFirst(hashes);
    if (base && head) setComparison({ base, head });
  }

  function multiMenu(hashes: string[]): MenuEntry[] {
    const head = info?.head_branch ?? "HEAD";
    const selected = commits.filter((c) => hashes.includes(c.hash));
    const merges = selected.some((c) => c.parents.length > 1);
    const already = selected.some((c) => headAncestors.has(c.hash));
    let pickHint: string | undefined;
    if (merges) pickHint = tr("Impossible avec un commit de merge dans la sélection");
    else if (already) pickHint = tr("Certains commits sont déjà dans {head}", { head });
    return [
      ...(hashes.length === 2
        ? [{ label: tr("Comparer les 2 commits"), hint: tr("Fichiers modifiés de l'un à l'autre"), action: () => compareSelected(hashes) }]
        : []),
      {
        label: tr("Cherry-pick des {length} commits dans {head}", { length: hashes.length, head }),
        hint: pickHint ?? tr("Du plus ancien au plus récent"),
        disabled: merges || already,
        action: () => cherryPickSelected(hashes),
      },
      { label: tr("Squasher les {length} commits sélectionnés…", { length: hashes.length }), action: () => squashSelected(hashes) },
      "separator",
      { label: tr("Annuler la sélection"), action: clearMulti },
    ];
  }

  /** Modifier le message, amend et annuler : seulement sur le dernier commit de la branche courante. */
  function headCommitEntries(commit: CommitInfo): MenuEntry[] {
    const head = info?.head_branch;
    if (!repoPath || !head || commit.hash !== info?.head_hash) return [];
    const path = repoPath;
    const ui = useUiStore.getState();
    const headBranch = branches.find((b) => b.is_head && !b.is_remote);
    const pushed = !!headBranch?.upstream && headBranch.ahead === 0;
    const pushedWarning = pushed ? tr("\nCe commit est déjà sur {upstream} : il faudra ensuite un push forcé.", { upstream: headBranch!.upstream }) : "";
    const fullMessage = async () => (await getCommitDetails(path, commit.hash)).message.trim();
    const { setCommitDraft } = useRepoStore.getState();

    return [
      { header: tr("Dernier commit de {head}", { head }) },
      {
        label: tr("Modifier le message…"),
        action: async () => {
          const message = await runGit(fullMessage, { refresh: false });
          if (message === undefined) return;
          const result = await ui.ask({
            title: tr("Modifier le message du commit"),
            message: tr("Le contenu du commit ne change pas ; les fichiers indexés n'y sont pas ajoutés.{pushedWarning}", { pushedWarning }),
            input: { multiline: true, initial: message },
            confirmLabel: tr("Modifier"),
          });
          const next = result?.value.trim();
          if (next && next !== message) await runGit(() => rewordHead(path, next), { success: tr("Message modifié") });
        },
      },
      {
        label: tr("Amend : ajouter les modifications indexées…"),
        hint: tr("Ouvre le panneau de commit en mode amend"),
        action: async () => {
          const message = await runGit(fullMessage, { refresh: false });
          if (message === undefined) return;
          const draft = useRepoStore.getState().commitDraft;
          setCommitDraft(draft.summary.trim() ? { amend: true } : { amend: true, ...draftFromMessage(message) });
          setSelectedCommit(null);
        },
      },
      {
        label: tr("Annuler ce commit"),
        hint: commit.parents.length ? tr("Ses modifications restent indexées") : tr("Premier commit du dépôt"),
        disabled: commit.parents.length === 0,
        action: async () => {
          const ok = await confirmAction(
            tr("Annuler le commit {short_hash} ?", { short_hash: commit.short_hash }),
            tr("{head} revient au commit précédent ; les modifications restent indexées, prêtes à être commitées à nouveau.{pushedWarning}", { head, pushedWarning }),
          );
          if (!ok) return;
          const message = await fullMessage().catch(() => commit.message);
          const done = await runGit(() => resetTo(path, commit.parents[0], "soft"), { success: tr("Commit annulé, modifications indexées") });
          if (done === undefined) return;
          if (!useRepoStore.getState().commitDraft.summary.trim()) setCommitDraft({ ...draftFromMessage(message), amend: false });
          setSelectedCommit(null);
        },
      },
      "separator",
    ];
  }

  /** Branche locale ou distante désignée par une étiquette du graphe. */
  function branchOf(ref: RefLabel): BranchInfo | undefined {
    if (ref.kind === "tag") return undefined;
    return branches.find((b) => b.name === ref.name && b.is_remote === (ref.kind === "remote"));
  }

  function refMenu(ref: RefLabel): MenuEntry[] | null {
    const b = branchOf(ref);
    if (!b) return null;
    return b.is_remote ? remoteMenu(b) : localMenu(b);
  }

  /**
   * Branches portées par le commit, autres que la branche courante : leurs actions principales en tête du menu.
   * Une branche distante n'apparaît que si sa branche locale n'est pas sur le même commit.
   */
  function tipBranchEntries(commit: CommitInfo): MenuEntry[] {
    const tips = commit.refs.map(branchOf).filter((b): b is BranchInfo => !!b && !b.is_head);
    const localNames = new Set(tips.filter((b) => !b.is_remote).map((b) => b.upstream ?? ""));
    const shown = tips.filter((b) => !b.is_remote || !localNames.has(b.name)).slice(0, 2);
    return shown.flatMap((b): MenuEntry[] => [{ header: b.is_remote ? tr("{name} (distante)", { name: b.name }) : b.name }, ...branchActions(b), "separator"]);
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [hasCommits]);

  const layout = useMemo(() => computeGraphLayout(visibleCommits), [visibleCommits]);
  // Largeur de toutes les voies, bornée par celle choisie avec la poignée : les voies au-delà sont coupées.
  const fullGraphWidth = H_PADDING * 2 + layout.laneCount * LANE_WIDTH + INFO_OFFSET;
  const graphWidthLimit = useUiStore((s) => s.graphWidth);
  const graphWidth = graphWidthLimit === null ? fullGraphWidth : Math.min(fullGraphWidth, graphWidthLimit);
  const graphTruncated = graphWidth < fullGraphWidth;

  // Fait défiler jusqu'au commit sélectionné (ex. clic sur une branche dans la barre latérale).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !selectedCommit) return;
    const row = layout.nodes.findIndex((n) => n.commit.hash === selectedCommit.hash);
    if (row === -1) return;
    const top = row * rowHeight;
    if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }, [selectedCommit, layout, rowHeight]);

  function commitMenu(commit: CommitInfo): MenuEntry[] {
    if (!repoPath) return [];
    const path = repoPath;
    const head = info?.head_branch ?? "HEAD";
    const ask = useUiStore.getState().ask;
    const isMerge = commit.parents.length > 1;
    const inHead = headAncestors.has(commit.hash);
    const inHeadHint = inHead ? tr("Déjà dans {head}", { head }) : undefined;

    const reset = (mode: "soft" | "mixed" | "hard") => async () => {
      const descriptions = {
        soft: tr("Les modifications des commits annulés restent indexées."),
        mixed: tr("Les modifications des commits annulés restent dans la copie de travail (non indexées)."),
        hard: tr("Toutes les modifications locales et les commits suivants seront perdus."),
      };
      if (await confirmAction(tr("Reset {mode} de {head} sur {short_hash} ?", { mode, head, short_hash: commit.short_hash }), descriptions[mode], mode === "hard"))
        await runGit(() => resetTo(path, commit.hash, mode));
    };

    return [
      ...headCommitEntries(commit),
      ...tipBranchEntries(commit),
      {
        label: tr("Checkout ce commit (HEAD détaché)"),
        action: () => runGit(() => checkoutCommit(path, commit.hash)),
      },
      {
        label: tr("Créer une branche ici…"),
        action: async () => {
          const result = await ask({
            title: tr("Nouvelle branche"),
            message: tr("Depuis {short_hash} — {message}", { short_hash: commit.short_hash, message: commit.message }),
            input: { placeholder: tr("nom-de-branche") },
            checkbox: { label: tr("Basculer sur la nouvelle branche"), initial: true },
            confirmLabel: tr("Créer"),
          });
          const name = result?.value.trim();
          if (name) await runGit(() => createBranch(path, name, commit.hash, result!.checked), { success: tr("Branche {name} créée", { name }) });
        },
      },
      {
        label: tr("Créer un tag ici…"),
        action: async () => {
          const name = await useUiStore.getState().ask({ title: tr("Nouveau tag"), input: { placeholder: "v1.0.0" }, confirmLabel: tr("Suivant") });
          const tag = name?.value.trim();
          if (!tag) return;
          const msg = await ask({
            title: `Tag ${tag}`,
            message: tr("Un message crée un tag annoté ; laisse vide pour un tag léger."),
            input: { placeholder: "Message (optionnel)", multiline: true },
            confirmLabel: tr("Créer le tag"),
          });
          if (msg) await runGit(() => createTag(path, tag, commit.hash, msg.value.trim() || null), { success: tr("Tag {tag} créé", { tag }) });
        },
      },
      "separator",
      {
        label: tr("Cherry-pick dans {head}", { head }),
        disabled: isMerge || inHead,
        hint: inHeadHint,
        action: async () => reportMerge(await runGit(() => cherryPick(path, commit.hash)), tr("Cherry-pick terminé")),
      },
      {
        label: tr("Revert ce commit"),
        disabled: isMerge,
        action: async () => reportMerge(await runGit(() => revertCommit(path, commit.hash)), tr("Revert terminé")),
      },
      {
        label: tr("Merger ce commit dans {head}", { head }),
        disabled: inHead,
        hint: inHeadHint,
        action: async () => reportMerge(await runGit(() => mergeBranch(path, commit.hash)), tr("Merge terminé")),
      },
      // Le rebase interactif réécrit les commits de la branche courante postérieurs à celui-ci : il doit en être un ancêtre.
      ...(inHead && commit.hash !== info?.head_hash
        ? [{
            label: tr("Rebase interactif de {head} depuis ce commit…", { head }),
            action: () => useUiStore.getState().setInteractiveRebaseBase(commit.hash),
          }]
        : []),
      {
        label: tr("Rebaser {head} sur ce commit", { head }),
        disabled: inHead,
        hint: inHeadHint,
        action: async () => {
          if (await confirmAction(tr("Rebaser {head} sur {short_hash} ?", { head, short_hash: commit.short_hash }), tr("Les commits de la branche courante seront réécrits.")))
            reportMerge(await runGit(() => rebaseOnto(path, commit.hash)), tr("Rebase terminé"));
        },
      },
      "separator",
      { label: tr("Reset {head} ici — soft", { head }), action: reset("soft") },
      { label: tr("Reset {head} ici — mixed", { head }), action: reset("mixed") },
      { label: tr("Reset {head} ici — hard", { head }), action: reset("hard"), danger: true },
      "separator",
      { label: tr("Copier le hash complet"), action: () => navigator.clipboard.writeText(commit.hash) },
      { label: tr("Copier le hash court"), action: () => navigator.clipboard.writeText(commit.short_hash) },
      { label: tr("Copier le message"), action: () => navigator.clipboard.writeText(commit.message) },
    ];
  }

  const wipRow = status.length > 0 && (
    <button
      className={`flex items-center gap-2 w-full shrink-0 px-3 h-7 text-xs border-b border-overlay/10 ${
        selectedCommit ? "hover:bg-overlay/5 text-[var(--color-muted)]" : "bg-overlay/10 text-[var(--color-text)]"
      }`}
      onClick={() => selectOne(null)}
      title={tr("Afficher les modifications en cours")}
    >
      <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-[var(--color-accent)]" aria-hidden />
      <span className="italic"><span aria-hidden>// </span>WIP</span>
      <span className="sr-only">{tr(", modifications en cours :")}</span>
      <span className="text-[var(--color-muted)]">
        {trn(status.length, "{n} fichier modifié", "{n} fichiers modifiés")}
      </span>
    </button>
  );

  if (commits.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {wipRow}
        <div className="flex-1 flex items-center justify-center text-[var(--color-muted)] text-sm">
          {tr("Aucun commit pour l'instant — indexe des fichiers et crée le premier commit")}
        </div>
      </div>
    );
  }

  const filterBar = (graphFilter.solo.length > 0 || graphFilter.hidden.length > 0) && repoPath && (
    <div className="flex items-center gap-2 px-3 h-7 shrink-0 text-[11px] border-b border-overlay/10 bg-[var(--color-accent)]/10">
      <span className="truncate text-[var(--color-text)]">
        {filterLabel(graphFilter)}
      </span>
      <button
        className="ml-auto shrink-0 text-[var(--color-accent-text)] hover:underline"
        onClick={() => useGraphFilterStore.getState().clear(repoPath)}
      >
        {tr("Tout afficher")}
      </button>
    </div>
  );

  if (visibleCommits.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {filterBar}
        <div className="flex-1 flex items-center justify-center text-[var(--color-muted)] text-sm">
          {searchQuery ? tr("Aucun commit correspondant à la recherche") : tr("Aucun commit à afficher avec ce filtre")}
        </div>
      </div>
    );
  }

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const lastRow = Math.min(layout.nodes.length, Math.ceil((scrollTop + size.height) / rowHeight) + OVERSCAN);

  return (
    <div className="flex flex-col h-full">
      {filterBar}
      {wipRow}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={containerRef}
          role="listbox"
          tabIndex={0}
          aria-label={tr("Historique des commits")}
          aria-multiselectable
          aria-activedescendant={selectedCommit ? rowId(selectedCommit.hash) : undefined}
          className="relative flex-1 overflow-y-auto overflow-x-hidden select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/60"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={handleListKey}
        >
          <div className="relative" style={{ height: visibleCommits.length * rowHeight }}>
            <GraphCanvas
              layout={layout}
              selectedHash={selectedCommit?.hash ?? null}
              headHash={info?.head_hash ?? null}
              onSelectRow={(row) => selectOne(layout.nodes[row]?.commit ?? null)}
              width={graphWidth}
              rowHeight={rowHeight}
              scrollTop={scrollTop}
              viewportHeight={size.height}
            />

            {layout.nodes.slice(firstRow, lastRow).map((node) => (
              <CommitRow
                key={node.commit.hash}
                commit={node.commit}
                row={node.row}
                count={layout.nodes.length}
                rowHeight={rowHeight}
                graphWidth={graphWidth}
                isSelected={node.commit.hash === selectedCommit?.hash || multi.includes(node.commit.hash)}
                containerWidth={size.width}
                localOnly={localOnly}
                onClick={(e) => handleRowClick(e, node.commit)}
                onContextMenu={(e) => {
                  if (multi.length > 1 && multi.includes(node.commit.hash)) return openMenu(e, multiMenu(multi));
                  selectOne(node.commit);
                  openMenu(e, commitMenu(node.commit));
                }}
                onRefMenu={(e, ref) => {
                  const items = refMenu(ref);
                  if (!items) return;
                  e.preventDefault();
                  e.stopPropagation();
                  selectOne(node.commit);
                  openMenu(e, items);
                }}
              />
            ))}
          </div>

          {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
          {pullRequestDialog}
        </div>
        {graphTruncated && (
          <div
            className="absolute inset-y-0 w-4 pointer-events-none bg-gradient-to-r from-transparent to-[var(--color-bg-primary)]"
            style={{ left: graphWidth - 16 }}
          />
        )}
        <GraphResizer graphWidth={graphWidth} fullWidth={fullGraphWidth} />
      </div>
    </div>
  );
}

/** Poignée entre l'arbre des branches et les commits : tirer pour le rétrécir, double-clic pour tout afficher. */
function GraphResizer({ graphWidth, fullWidth }: { graphWidth: number; fullWidth: number }) {
  const setGraphWidth = useUiStore((s) => s.setGraphWidth);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    // Au-delà de la largeur de toutes les voies, plus de limite : l'arbre suit à nouveau le nombre de voies.
    const move = (ev: PointerEvent) => {
      const width = graphWidth + ev.clientX - startX;
      setGraphWidth(width >= fullWidth ? null : width);
    };
    const up = () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Au clavier : flèches gauche / droite (Maj : pas plus grand), Entrée : tout afficher.
  function onKeyDown(e: React.KeyboardEvent) {
    const delta = resizeKeyDelta(e, "x");
    if (e.key === "Enter") setGraphWidth(null);
    else if (delta === null) return;
    else setGraphWidth(graphWidth + delta >= fullWidth ? null : graphWidth + delta);
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={tr("Largeur de l'arbre des branches")}
      aria-valuenow={graphWidth}
      aria-valuemin={MIN_GRAPH_WIDTH}
      aria-valuemax={Math.max(fullWidth, graphWidth)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 w-1 -ml-0.5 cursor-col-resize z-10 hover:bg-sky-400/40 active:bg-sky-400/60 focus-visible:bg-[var(--color-accent)] outline-none"
      style={{ left: graphWidth }}
      onPointerDown={startResize}
      onDoubleClick={() => setGraphWidth(null)}
      title={tr("Redimensionner l'arbre des branches (double-clic ou Entrée : tout afficher ; flèches au clavier)")}
    >
      {/* Fine bordure toujours visible pour repérer la poignée, comme celle des panneaux latéraux. */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-overlay/10 group-hover:bg-transparent" />
    </div>
  );
}

/** Résumé du filtre du graphe : branches en solo, ou branches masquées. */
function filterLabel(filter: GraphFilter): string {
  const names = (keys: string[]) => keys.map((k) => k.slice(k.indexOf(":") + 1)).join(", ");
  if (filter.solo.length) return tr("Solo : {names}", { names: names(filter.solo) });
  const n = filter.hidden.length;
  return n > 1 ? tr("{n} branches masquées : {names}", { n, names: names(filter.hidden) }) : tr("Branche masquée : {names}", { names: names(filter.hidden) });
}

/** Identifiant DOM d'une ligne du graphe (descendant actif de la liste). */
const rowId = (hash: string) => `commit-row-${hash}`;

interface CommitRowProps {
  commit: CommitInfo;
  row: number;
  /** Nombre total de lignes : la liste est virtualisée, seules les lignes visibles existent. */
  count: number;
  rowHeight: number;
  graphWidth: number;
  isSelected: boolean;
  containerWidth: number;
  localOnly: Set<string>;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Clic droit sur l'étiquette d'une branche : menu de la branche plutôt que celui du commit. */
  onRefMenu: (e: React.MouseEvent, ref: RefLabel) => void;
}

function CommitRow({
  commit, row, count, rowHeight, graphWidth, isSelected, containerWidth, localOnly, onClick, onContextMenu, onRefMenu,
}: CommitRowProps) {
  const date = new Date(commit.timestamp * 1000).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      id={rowId(commit.hash)}
      role="option"
      aria-selected={isSelected}
      aria-posinset={row + 1}
      aria-setsize={count}
      className={`absolute flex items-center gap-3 px-2 cursor-pointer transition-colors duration-100 ${
        isSelected ? "bg-overlay/10" : "hover:bg-overlay/5"
      }`}
      style={{
        top: row * rowHeight,
        left: graphWidth,
        width: Math.max(containerWidth - graphWidth, 0),
        height: rowHeight,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {commit.refs.length > 0 && (
        <div className="flex gap-1 shrink-0 max-w-[45%] overflow-hidden">
          {commit.refs.slice(0, 4).map((ref) => <RefBadge
              key={`${ref.kind}:${ref.name}`}
              label={ref}
              localOnly={(ref.kind === "head" || ref.kind === "local") && localOnly.has(ref.name)}
              onContextMenu={(e) => onRefMenu(e, ref)}
            />)}
          {commit.refs.length > 4 && (
            <span className="text-[10px] text-[var(--color-muted)]" title={commit.refs.slice(4).map((r) => r.name).join("\n")}>
              <span aria-hidden>+{commit.refs.length - 4}</span>
              <span className="sr-only">{tr("et")}{" "}{commit.refs.slice(4).map((r) => `${REF_KINDS[r.kind]} ${r.name}`).join(", ")}</span>
            </span>
          )}
        </div>
      )}
      <span className="text-xs text-[var(--color-text)] truncate flex-1">
        {commit.parents.length > 1 && <span className="sr-only">{tr("Commit de fusion :")}{" "}</span>}
        {commit.message}
      </span>
      {/* Fenêtre étroite : auteur, hash et date restent lus par les lecteurs d'écran et affichés dans le détail du commit. */}
      <span className="text-[11px] text-[var(--color-muted)] shrink-0 max-w-32 truncate max-[760px]:sr-only">{commit.author}</span>
      <span className="text-[11px] text-[var(--color-muted)] shrink-0 font-mono max-[760px]:sr-only">{commit.short_hash}</span>
      <span className="text-[11px] text-[var(--color-muted)] shrink-0 w-24 text-right max-[760px]:sr-only">{date}</span>
    </div>
  );
}

const REF_STYLES: Record<RefLabel["kind"], string> = {
  head: "bg-[var(--color-accent-solid)] text-white border-[var(--color-accent-solid)]",
  local: "bg-[var(--color-accent)]/15 text-[var(--color-accent-text)] border-[var(--color-accent)]/40",
  remote: "bg-sky-500/15 text-sky-300 border-sky-400/40",
  tag: "bg-amber-500/15 text-amber-300 border-amber-400/40",
};

const REF_ICONS: Record<RefLabel["kind"], LucideIcon> = { head: GitBranch, local: GitBranch, remote: Cloud, tag: Tag };

/** Nature de l'étiquette, restituée à la place de son icône. */
const REF_KINDS: Record<RefLabel["kind"], string> = { head: tr("branche courante"), local: tr("branche"), remote: tr("branche distante"), tag: "tag" };

function RefBadge({ label, localOnly, onContextMenu }: {
  label: RefLabel;
  localOnly: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const title = label.kind === "head" ? tr("{name} (branche courante)", { name: label.name }) : label.name;
  const Icon = REF_ICONS[label.kind];
  return (
    <span
      className={`px-1 text-[10px] rounded font-mono border whitespace-nowrap ${REF_STYLES[label.kind]} ${localOnly ? "border-dashed" : ""}`}
      title={localOnly ? tr("{title} — uniquement en local, absente des remotes", { title }) : title}
      onContextMenu={onContextMenu}
    >
      <Icon size={10} className="inline mr-0.5 -mt-0.5" />
      <span className="sr-only">{REF_KINDS[label.kind]} </span>
      {label.name}
      {localOnly && <span className="ml-1 italic"><span aria-hidden>{tr("local")}</span><span className="sr-only">{tr(", uniquement en local")}</span></span>}
      <span className="sr-only">, </span>
    </span>
  );
}
