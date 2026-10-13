import { useRef, useState, useEffect, useMemo } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore, confirmAction } from "../store/useUiStore";
import { computeGraphLayout } from "./layout";
import { filterCommits } from "../search/filterCommits";
import { GraphCanvas, H_PADDING, LANE_WIDTH } from "./GraphCanvas";
import { ROW_HEIGHTS, useDisplayStore } from "../store/useDisplayStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../components/ContextMenu";
import {
  checkoutCommit, cherryPick, createBranch, createTag, interactiveRebase, mergeBranch, rebaseOnto, rebaseTodo, resetTo,
  revertCommit,
} from "../ipc/commands";
import { reportInteractive, reportMerge, runGit } from "../lib/actions";
import { localOnlyBranches } from "../lib/branches";
import { squashPlan } from "../lib/squash";
import { clickModifiers, clickSelection, EMPTY_SELECTION, pruneSelection, type MultiSelection } from "../lib/multiSelect";
import type { CommitInfo, RefLabel } from "../types/git";

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
  const visibleCommits = useMemo(() => filterCommits(commits, searchQuery), [commits, searchQuery]);
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
      ui.notify("error", "Le premier commit du dépôt ne peut pas être squashé");
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
      title: `Squasher ${hashes.length} commits sur ${head}`,
      message: "Ils seront fusionnés en un seul commit, à la place du plus ancien. L'historique de la branche sera réécrit.",
      input: { multiline: true, initial: check.commits.map((c) => c.message.trim()).join("\n\n") },
      confirmLabel: "Squasher",
    });
    if (!result) return;
    const plan = squashPlan(todo, hashes, result.value);
    if (typeof plan === "string") return;

    clearMulti();
    const outcome = await runGit(() => interactiveRebase(path, base, plan.steps, plan.mode), { busy: "Squash…" });
    if (outcome && !outcome.stopped) ui.notify("success", `${hashes.length} commits squashés (ancienne position : ORIG_HEAD)`);
    else reportInteractive(outcome);
  }

  function multiMenu(hashes: string[]): MenuEntry[] {
    return [
      { label: `Squasher les ${hashes.length} commits sélectionnés…`, action: () => squashSelected(hashes) },
      "separator",
      { label: "Annuler la sélection", action: clearMulti },
    ];
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
  const graphWidth = H_PADDING * 2 + layout.laneCount * LANE_WIDTH + INFO_OFFSET;

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

    const reset = (mode: "soft" | "mixed" | "hard") => async () => {
      const descriptions = {
        soft: "Les modifications des commits annulés restent indexées.",
        mixed: "Les modifications des commits annulés restent dans la copie de travail (non indexées).",
        hard: "Toutes les modifications locales et les commits suivants seront perdus.",
      };
      if (await confirmAction(`Reset ${mode} de ${head} sur ${commit.short_hash} ?`, descriptions[mode], mode === "hard"))
        await runGit(() => resetTo(path, commit.hash, mode));
    };

    return [
      {
        label: "Checkout ce commit (HEAD détaché)",
        action: () => runGit(() => checkoutCommit(path, commit.hash)),
      },
      {
        label: "Créer une branche ici…",
        action: async () => {
          const result = await ask({
            title: "Nouvelle branche",
            message: `Depuis ${commit.short_hash} — ${commit.message}`,
            input: { placeholder: "nom-de-branche" },
            checkbox: { label: "Basculer sur la nouvelle branche", initial: true },
            confirmLabel: "Créer",
          });
          const name = result?.value.trim();
          if (name) await runGit(() => createBranch(path, name, commit.hash, result!.checked), { success: `Branche ${name} créée` });
        },
      },
      {
        label: "Créer un tag ici…",
        action: async () => {
          const name = await useUiStore.getState().ask({ title: "Nouveau tag", input: { placeholder: "v1.0.0" }, confirmLabel: "Suivant" });
          const tag = name?.value.trim();
          if (!tag) return;
          const msg = await ask({
            title: `Tag ${tag}`,
            message: "Un message crée un tag annoté ; laisse vide pour un tag léger.",
            input: { placeholder: "Message (optionnel)", multiline: true },
            confirmLabel: "Créer le tag",
          });
          if (msg) await runGit(() => createTag(path, tag, commit.hash, msg.value.trim() || null), { success: `Tag ${tag} créé` });
        },
      },
      "separator",
      {
        label: `Cherry-pick dans ${head}`,
        disabled: isMerge,
        action: async () => reportMerge(await runGit(() => cherryPick(path, commit.hash)), "Cherry-pick terminé"),
      },
      {
        label: "Revert ce commit",
        disabled: isMerge,
        action: async () => reportMerge(await runGit(() => revertCommit(path, commit.hash)), "Revert terminé"),
      },
      {
        label: `Merger ce commit dans ${head}`,
        action: async () => reportMerge(await runGit(() => mergeBranch(path, commit.hash)), "Merge terminé"),
      },
      {
        label: `Rebase interactif de ${head} depuis ce commit…`,
        disabled: commit.hash === info?.head_hash,
        action: () => useUiStore.getState().setInteractiveRebaseBase(commit.hash),
      },
      {
        label: `Rebaser ${head} sur ce commit`,
        action: async () => {
          if (await confirmAction(`Rebaser ${head} sur ${commit.short_hash} ?`, "Les commits de la branche courante seront réécrits."))
            reportMerge(await runGit(() => rebaseOnto(path, commit.hash)), "Rebase terminé");
        },
      },
      "separator",
      { label: `Reset ${head} ici — soft`, action: reset("soft") },
      { label: `Reset ${head} ici — mixed`, action: reset("mixed") },
      { label: `Reset ${head} ici — hard`, action: reset("hard"), danger: true },
      "separator",
      { label: "Copier le hash complet", action: () => navigator.clipboard.writeText(commit.hash) },
      { label: "Copier le hash court", action: () => navigator.clipboard.writeText(commit.short_hash) },
      { label: "Copier le message", action: () => navigator.clipboard.writeText(commit.message) },
    ];
  }

  const wipRow = status.length > 0 && (
    <button
      className={`flex items-center gap-2 w-full shrink-0 px-3 h-7 text-xs border-b border-overlay/10 ${
        selectedCommit ? "hover:bg-overlay/5 text-[var(--color-muted)]" : "bg-overlay/10 text-[var(--color-text)]"
      }`}
      onClick={() => selectOne(null)}
      title="Afficher les modifications en cours"
    >
      <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-[var(--color-accent)]" />
      <span className="italic">// WIP</span>
      <span className="text-[var(--color-muted)]">
        {status.length} fichier{status.length > 1 ? "s" : ""} modifié{status.length > 1 ? "s" : ""}
      </span>
    </button>
  );

  if (commits.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {wipRow}
        <div className="flex-1 flex items-center justify-center text-[var(--color-muted)] text-sm">
          Aucun commit pour l'instant — indexe des fichiers et crée le premier commit
        </div>
      </div>
    );
  }

  if (visibleCommits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-muted)] text-sm">
        Aucun commit correspondant à la recherche
      </div>
    );
  }

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const lastRow = Math.min(layout.nodes.length, Math.ceil((scrollTop + size.height) / rowHeight) + OVERSCAN);

  return (
    <div className="flex flex-col h-full">
      {wipRow}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-y-auto overflow-x-hidden select-none"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
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
            />
          ))}
        </div>

        {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      </div>
    </div>
  );
}

interface CommitRowProps {
  commit: CommitInfo;
  row: number;
  rowHeight: number;
  graphWidth: number;
  isSelected: boolean;
  containerWidth: number;
  localOnly: Set<string>;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function CommitRow({ commit, row, rowHeight, graphWidth, isSelected, containerWidth, localOnly, onClick, onContextMenu }: CommitRowProps) {
  const date = new Date(commit.timestamp * 1000).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div
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
            />)}
          {commit.refs.length > 4 && <span className="text-[10px] text-[var(--color-muted)]">+{commit.refs.length - 4}</span>}
        </div>
      )}
      <span className="text-xs text-[var(--color-text)] truncate flex-1">{commit.message}</span>
      <span className="text-[11px] text-[var(--color-muted)] shrink-0 max-w-32 truncate">{commit.author}</span>
      <span className="text-[11px] text-[var(--color-muted)] shrink-0 font-mono">{commit.short_hash}</span>
      <span className="text-[11px] text-[var(--color-muted)] shrink-0 w-24 text-right">{date}</span>
    </div>
  );
}

const REF_STYLES: Record<RefLabel["kind"], string> = {
  head: "bg-[var(--color-accent)] text-white border-[var(--color-accent)]",
  local: "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/40",
  remote: "bg-sky-500/15 text-sky-300 border-sky-400/40",
  tag: "bg-amber-500/15 text-amber-300 border-amber-400/40",
};

const REF_ICONS: Record<RefLabel["kind"], string> = { head: "⎇", local: "⎇", remote: "☁", tag: "⌂" };

function RefBadge({ label, localOnly }: { label: RefLabel; localOnly: boolean }) {
  const title = label.kind === "head" ? `${label.name} (branche courante)` : label.name;
  return (
    <span
      className={`px-1 text-[10px] rounded font-mono border whitespace-nowrap ${REF_STYLES[label.kind]} ${localOnly ? "border-dashed" : ""}`}
      title={localOnly ? `${title} — uniquement en local, absente des remotes` : title}
    >
      {REF_ICONS[label.kind]} {label.name}
      {localOnly && <span className="ml-1 opacity-70 italic">local</span>}
    </span>
  );
}
