import { useEffect, useState } from "react";
import { List, ListTree } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRepoStore, type CenterView, type CommitDraft } from "../store/useRepoStore";
import { useUiStore, confirmAction } from "../store/useUiStore";
import {
  abortInteractiveRebase, abortMerge, abortRebase, continueInteractiveRebase, continueRebase, createCommit, discardFiles, getCommitDetails, lfsTrack, stageAll,
  stageFiles, unstageAll, unstageFiles,
} from "../ipc/commands";
import { errorMessage, reportInteractive, reportMerge, runGit } from "../lib/actions";
import { ContextMenu, useContextMenu, type MenuEntry } from "./ContextMenu";
import { plural } from "../lib/strings";
import { fileTree, visibleFiles, type FileNode } from "../lib/fileTree";
import { clickModifiers, clickSelection, EMPTY_SELECTION, pruneSelection, type MultiSelection } from "../lib/multiSelect";
import type { FileStatus, InteractiveStop, RepoState } from "../types/git";

const STATE_LABELS: Record<Exclude<RepoState, "clean">, string> = {
  merge: "Merge en cours",
  rebase: "Rebase en cours",
  cherrypick: "Cherry-pick en cours",
  revert: "Revert en cours",
  bisect: "Bisect en cours",
  apply: "Application de patch en cours",
};

/** Le fichier est-il celui affiché au centre (diff ou résolution de conflit) ? */
function isShown(center: CenterView, f: FileStatus): boolean {
  if (center.kind === "conflict") return center.path === f.path;
  return center.kind === "diff" && center.source.type === "workdir" && center.path === f.path && center.source.staged === f.staged;
}

/** Consigne affichée pendant un merge / rebase / cherry-pick… */
function operationHint(state: RepoState, conflicts: number): string {
  if (conflicts > 0) return `${plural(conflicts, "conflit")} à résoudre : clique sur un fichier pour choisir les versions.`;
  return state === "rebase" ? "Tous les conflits sont résolus : continue le rebase." : "Tous les conflits sont résolus : commite pour terminer.";
}

function commitLabel(committing: boolean, amend: boolean, state: RepoState, stagedCount: number): string {
  if (committing) return "Commit…";
  if (amend) return "Modifier le dernier commit";
  if (state === "merge") return "Commiter le merge";
  return `Commiter ${plural(stagedCount, "fichier")}`;
}

function interactiveHint(stop: InteractiveStop, conflicts: number): string {
  if (stop.reason === "edit") return "Modifie ce commit (case « amend » ci-dessous) ou ajoute des commits, puis Continuer.";
  if (conflicts > 0) return `${plural(conflicts, "conflit")} à résoudre (clique sur un fichier), puis Continuer.`;
  return "Conflits résolus : clique sur Continuer pour créer le commit et poursuivre.";
}

const TREE_KEY = "git-client.stagingTree";

/** Section du panneau : conflits, non indexé, indexé. */
type Section = "c" | "u" | "s";

function sectionOf(f: FileStatus): Section {
  if (f.status === "conflicted") return "c";
  return f.staged ? "s" : "u";
}

/** Identifiant d'un fichier dans la sélection : un même chemin peut être à la fois indexé et non indexé. */
const keyOf = (f: FileStatus) => `${sectionOf(f)}:${f.path}`;

function loadTreeMode(): boolean {
  try {
    return localStorage.getItem(TREE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function StagingPanel() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const info = useRepoStore((s) => s.info);
  const status = useRepoStore((s) => s.status);
  const center = useRepoStore((s) => s.center);
  const lfs = useRepoStore((s) => s.lfs);
  const setCenter = useRepoStore((s) => s.setCenter);
  const notify = useUiStore((s) => s.notify);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const { summary, description, amend } = useRepoStore((s) => s.commitDraft);
  const setCommitDraft = useRepoStore((s) => s.setCommitDraft);
  const [committing, setCommitting] = useState(false);
  const [treeMode, setTreeMode] = useState(loadTreeMode);
  /** Dossiers repliés, « section:chemin ». */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Fichiers sélectionnés (Ctrl / Cmd + clic, Maj + clic pour une plage), tous dans la même section.
  const [selection, setSelection] = useState<MultiSelection>(EMPTY_SELECTION);
  const clearSelection = () => setSelection((s) => ({ ...s, items: [] }));

  const conflicted = status.filter((f) => f.status === "conflicted");
  const staged = status.filter((f) => f.staged);
  const unstaged = status.filter((f) => !f.staged && f.status !== "conflicted");
  const state = info?.state ?? "clean";
  const pendingMessage = info?.pending_message ?? null;
  const interactive = !!info?.interactive_rebase;

  /** Brouillon de ce dépôt : ignoré si l'utilisateur a changé d'onglet pendant une opération. */
  function updateDraft(patch: Partial<CommitDraft>) {
    if (useRepoStore.getState().repoPath === repoPath) setCommitDraft(patch);
  }
  const setSummary = (summary: string) => updateDraft({ summary });
  const setDescription = (description: string) => updateDraft({ description });
  const setAmend = (amend: boolean) => updateDraft({ amend });

  // Message préparé par git (merge, cherry-pick, revert) : on pré-remplit le formulaire,
  // sans écraser un message déjà saisi (retour sur l'onglet).
  useEffect(() => {
    if (!pendingMessage || state === "clean" || state === "rebase" || interactive) return;
    if (useRepoStore.getState().commitDraft.summary) return;
    const [first, ...rest] = pendingMessage.split("\n");
    setCommitDraft({ summary: first, description: rest.filter((l) => !l.startsWith("#")).join("\n").trim() });
  }, [pendingMessage, state, interactive, setCommitDraft]);

  // Les fichiers indexés, désindexés ou commités sortent de la sélection.
  useEffect(() => {
    const keys = new Set(status.map(keyOf));
    setSelection((s) => pruneSelection(s, (k) => keys.has(k)));
  }, [status]);

  if (!repoPath) return null;
  const path = repoPath;

  function toggleTreeMode() {
    const next = !treeMode;
    setTreeMode(next);
    try {
      localStorage.setItem(TREE_KEY, next ? "1" : "0");
    } catch {
      // stockage indisponible : choix gardé pour la session
    }
  }

  function toggleFolder(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const isOpen = (section: Section) => (p: string) => !collapsed.has(`${section}:${p}`);
  const sectionFiles: Record<Section, FileStatus[]> = { c: conflicted, u: unstaged, s: staged };
  const picked = new Set(selection.items);
  const isPicked = (f: FileStatus) => picked.has(keyOf(f));
  /** Fichiers sélectionnés dans une section (vide s'il n'y en a qu'un : c'est une sélection simple). */
  function pickedIn(section: Section): FileStatus[] {
    const files = sectionFiles[section].filter(isPicked);
    return files.length > 1 ? files : [];
  }
  /** Fichiers visés par une action sur `f` : toute la sélection si `f` en fait partie, sinon `f` seul. */
  function targets(f: FileStatus): FileStatus[] {
    const files = isPicked(f) ? pickedIn(sectionOf(f)) : [];
    return files.length ? files : [f];
  }
  const pathsOf = (files: FileStatus[]) => files.map((f) => f.path);

  function handleClick(e: React.MouseEvent, f: FileStatus) {
    const section = sectionOf(f);
    const inSection = (k: string | null) => !!k?.startsWith(`${section}:`);
    // Clic dans une autre section : on repart d'une sélection vide.
    const base = inSection(selection.anchor) || selection.items.some(inSection) ? selection : EMPTY_SELECTION;
    const shown = sectionFiles[section].find((x) => isShown(center, x));
    const files = sectionFiles[section];
    const order = treeMode ? visibleFiles(fileTree(files, (x) => x.path), isOpen(section)) : files;
    const next = clickSelection(order.map(keyOf), base, keyOf(f), clickModifiers(e), { current: shown ? keyOf(shown) : null });
    setSelection(next.selection);
    if (next.plain) show(f);
  }

  /** Fichiers d'une section, en liste ou en arbre selon le mode choisi. */
  function fileList(
    section: Section,
    files: FileStatus[],
    row: (f: FileStatus, depth?: number) => React.ReactNode,
    folderActions?: (files: FileStatus[]) => React.ReactNode,
  ) {
    if (!treeMode) return files.map((f) => row(f));
    return (
      <FileTree
        nodes={fileTree(files, (f) => f.path)}
        depth={0}
        isOpen={isOpen(section)}
        onToggle={(p) => toggleFolder(`${section}:${p}`)}
        row={row}
        folderActions={folderActions}
      />
    );
  }

  const viewToggle = (
    <HeaderBtn title={treeMode ? "Afficher en liste" : "Afficher en arborescence"} onClick={toggleTreeMode}>
      {treeMode ? <List size={12} /> : <ListTree size={12} />}
    </HeaderBtn>
  );


  function show(f: FileStatus) {
    if (f.status === "conflicted") setCenter({ kind: "conflict", path: f.path });
    else setCenter({ kind: "diff", path: f.path, source: { type: "workdir", staged: f.staged } });
  }

  async function discard(files: FileStatus[]) {
    const label = files.length === 1 ? `« ${files[0].path} »` : `${files.length} fichiers`;
    const untracked = files.some((f) => f.status === "untracked");
    const ok = await confirmAction(
      `Annuler les modifications de ${label} ?`,
      untracked ? "Les fichiers non suivis seront supprimés définitivement." : "Les modifications non indexées seront perdues.",
      true,
    );
    if (ok) await runGit(() => discardFiles(path, files.map((f) => f.path)));
  }

  /** Menu d'une sélection de plusieurs fichiers d'une même section. */
  function filesMenu(files: FileStatus[]): MenuEntry[] {
    const n = plural(files.length, "fichier");
    const section = sectionOf(files[0]);
    return [
      section === "s"
        ? { label: `Désindexer ${n}`, action: () => runGit(() => unstageFiles(path, pathsOf(files))) }
        : { label: section === "c" ? `Marquer ${n} comme résolus (indexer)` : `Indexer ${n}`, action: () => runGit(() => stageFiles(path, pathsOf(files))) },
      ...(section === "u" ? [{ label: `Annuler les modifications de ${n}…`, danger: true, action: () => discard(files) }] : []),
      "separator",
      { label: "Copier les chemins", action: () => navigator.clipboard.writeText(pathsOf(files).join("\n")) },
      { label: "Annuler la sélection", action: clearSelection },
    ];
  }

  function fileMenu(f: FileStatus): MenuEntry[] {
    const files = targets(f);
    if (files.length > 1) return filesMenu(files);
    const abs = `${path}/${f.path}`;
    return [
      f.staged
        ? { label: "Désindexer", action: () => runGit(() => unstageFiles(path, [f.path])) }
        : { label: f.status === "conflicted" ? "Marquer comme résolu (indexer)" : "Indexer", action: () => runGit(() => stageFiles(path, [f.path])) },
      ...(!f.staged && f.status !== "conflicted"
        ? [{ label: "Annuler les modifications…", danger: true, action: () => discard([f]) }]
        : []),
      ...lfsEntry(f),
      "separator" as const,
      { label: "Copier le chemin", action: () => navigator.clipboard.writeText(f.path) },
      { label: "Afficher dans le gestionnaire de fichiers", action: () => revealItemInDir(abs).catch((e) => notify("error", errorMessage(e))) },
    ];
  }

  /** Propose de suivre l'extension du fichier avec LFS (fichier pas encore commité). */
  function lfsEntry(f: FileStatus): MenuEntry[] {
    const ext = f.path.match(/\.[^./]+$/)?.[0];
    if (!ext || f.status !== "untracked") return [];
    const pattern = `*${ext}`;
    if (lfs?.patterns.includes(pattern)) return [];
    return [{
      label: `Suivre les fichiers ${pattern} avec Git LFS`,
      action: () => runGit(() => lfsTrack(path, pattern), { success: `${pattern} suivi avec LFS (.gitattributes modifié)` }),
    }];
  }

  async function toggleAmend(checked: boolean) {
    setAmend(checked);
    if (!checked || !info?.head_hash || summary.trim()) return;
    try {
      const details = await getCommitDetails(path, info.head_hash);
      updateDraft({ summary: details.summary, description: details.message.slice(details.summary.length).trim() });
    } catch (e) {
      notify("error", errorMessage(e));
    }
  }

  const canCommit =
    !!summary.trim() && conflicted.length === 0 && (staged.length > 0 || amend || state === "merge") && !committing;

  async function handleCommit() {
    if (!canCommit) return;
    setCommitting(true);
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    const hash = await runGit(() => createCommit(path, message, amend), {
      success: amend ? "Commit modifié" : undefined,
    });
    setCommitting(false);
    if (hash) {
      updateDraft({ summary: "", description: "", amend: false });
      if (center.kind !== "graph") setCenter({ kind: "graph" });
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-secondary)] text-sm">
      {info?.interactive_rebase && (
        <InteractiveBanner
          stop={info.interactive_rebase}
          conflicts={conflicted.length}
          onContinue={async () => reportInteractive(await runGit(() => continueInteractiveRebase(path)))}
          onAbort={async () => {
            if (await confirmAction("Annuler le rebase interactif ?", "La branche et les fichiers reviennent à leur état d'avant le rebase.", true))
              await runGit(() => abortInteractiveRebase(path), { success: "Rebase interactif annulé" });
          }}
        />
      )}

      {state !== "clean" && !info?.interactive_rebase && (
        <div className="px-3 py-2 border-b border-amber-400/30 bg-amber-500/10 flex flex-col gap-1.5 shrink-0">
          <p className="text-xs font-semibold text-amber-300">{STATE_LABELS[state]}</p>
          <p className="text-[11px] text-amber-200/80">
            {operationHint(state, conflicted.length)}
          </p>
          <div className="flex gap-2">
            {state === "rebase" ? (
              <>
                <SmallBtn
                  disabled={conflicted.length > 0}
                  onClick={async () => reportMerge(await runGit(() => continueRebase(path)), "Rebase terminé")}
                >
                  Continuer
                </SmallBtn>
                <SmallBtn danger onClick={async () => {
                  if (await confirmAction("Annuler le rebase ?", "La branche revient à son état d'avant le rebase.", true))
                    await runGit(() => abortRebase(path), { success: "Rebase annulé" });
                }}>
                  Annuler le rebase
                </SmallBtn>
              </>
            ) : (
              <SmallBtn danger onClick={async () => {
                if (await confirmAction("Tout annuler ?", "La copie de travail revient à l'état du dernier commit.", true)) {
                  await runGit(() => abortMerge(path), { success: "Opération annulée" });
                  updateDraft({ summary: "", description: "" });
                }
              }}>
                Annuler l'opération
              </SmallBtn>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {conflicted.length > 0 && (
          <FileSection
            title="Conflits"
            count={conflicted.length}
            actions={
              <>
                <SelectionActions files={pickedIn("c")} onClear={clearSelection}>
                  <HeaderBtn title="Marquer la sélection comme résolue" onClick={() => runGit(() => stageFiles(path, pathsOf(pickedIn("c"))))}>Résolus</HeaderBtn>
                </SelectionActions>
                {viewToggle}
              </>
            }
          >
            {fileList("c", conflicted, (f, depth) => (
              <FileRow
                key={`c:${f.path}`}
                file={f}
                depth={depth}
                shown={isShown(center, f)}
                picked={isPicked(f)}
                onClick={(e) => handleClick(e, f)}
                onContextMenu={(e) => openMenu(e, fileMenu(f))}
              />
            ))}
          </FileSection>
        )}

        <FileSection
          title="Non indexé"
          count={unstaged.length}
          actions={unstaged.length > 0 && (
            <>
              <SelectionActions
                files={pickedIn("u")}
                onClear={clearSelection}
                fallback={
                  <>
                    <HeaderBtn title="Annuler toutes les modifications" onClick={() => discard(unstaged)}>↺</HeaderBtn>
                    <HeaderBtn title="Tout indexer" onClick={() => runGit(() => stageAll(path))}>Tout indexer</HeaderBtn>
                  </>
                }
              >
                <HeaderBtn title="Annuler les modifications de la sélection" onClick={() => discard(pickedIn("u"))}>↺</HeaderBtn>
                <HeaderBtn title="Indexer la sélection" onClick={() => runGit(() => stageFiles(path, pathsOf(pickedIn("u"))))}>Indexer</HeaderBtn>
              </SelectionActions>
              {conflicted.length === 0 && viewToggle}
            </>
          )}
        >
          {fileList("u", unstaged, (f, depth) => (
            <FileRow
              key={`u:${f.path}`}
              file={f}
              depth={depth}
              shown={isShown(center, f)}
              picked={isPicked(f)}
              onClick={(e) => handleClick(e, f)}
              onContextMenu={(e) => openMenu(e, fileMenu(f))}
              actions={
                <>
                  <RowBtn title="Annuler les modifications" onClick={() => discard(targets(f))}>↺</RowBtn>
                  <RowBtn title="Indexer" onClick={() => runGit(() => stageFiles(path, pathsOf(targets(f))))}>+</RowBtn>
                </>
              }
            />
          ), (files) => (
            <>
              <RowBtn title="Annuler les modifications du dossier" onClick={() => discard(files)}>↺</RowBtn>
              <RowBtn title="Indexer le dossier" onClick={() => runGit(() => stageFiles(path, files.map((f) => f.path)))}>+</RowBtn>
            </>
          ))}
        </FileSection>

        <FileSection
          title="Indexé"
          count={staged.length}
          actions={staged.length > 0 && (
            <>
              <SelectionActions
                files={pickedIn("s")}
                onClear={clearSelection}
                fallback={<HeaderBtn title="Tout désindexer" onClick={() => runGit(() => unstageAll(path))}>Tout désindexer</HeaderBtn>}
              >
                <HeaderBtn title="Désindexer la sélection" onClick={() => runGit(() => unstageFiles(path, pathsOf(pickedIn("s"))))}>Désindexer</HeaderBtn>
              </SelectionActions>
              {conflicted.length === 0 && unstaged.length === 0 && viewToggle}
            </>
          )}
        >
          {fileList("s", staged, (f, depth) => (
            <FileRow
              key={`s:${f.path}`}
              file={f}
              depth={depth}
              shown={isShown(center, f)}
              picked={isPicked(f)}
              onClick={(e) => handleClick(e, f)}
              onContextMenu={(e) => openMenu(e, fileMenu(f))}
              actions={<RowBtn title="Désindexer" onClick={() => runGit(() => unstageFiles(path, pathsOf(targets(f))))}>−</RowBtn>}
            />
          ), (files) => (
            <RowBtn title="Désindexer le dossier" onClick={() => runGit(() => unstageFiles(path, files.map((f) => f.path)))}>−</RowBtn>
          ))}
        </FileSection>

        {status.length === 0 && state === "clean" && (
          <p className="p-3 text-xs text-[var(--color-muted)] italic">Aucune modification en cours</p>
        )}
      </div>

      <div className="p-2 border-t border-overlay/10 flex flex-col gap-1.5 shrink-0">
        <input
          className={commitInput}
          placeholder="Résumé du commit"
          value={summary}
          maxLength={200}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && handleCommit()}
        />
        <textarea
          className={`${commitInput} resize-none`}
          rows={3}
          placeholder="Description (optionnelle)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && handleCommit()}
        />
        <label className="flex items-center gap-2 text-[11px] text-[var(--color-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={amend}
            disabled={!info?.head_hash || state !== "clean"}
            onChange={(e) => toggleAmend(e.target.checked)}
          />
          Modifier le dernier commit (amend)
        </label>
        <button
          className="bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-40 text-white text-xs font-semibold py-1.5 rounded transition-opacity"
          onClick={handleCommit}
          disabled={!canCommit}
          title="Ctrl+Entrée"
        >
          {commitLabel(committing, amend, state, staged.length)}
        </button>
      </div>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}

function InteractiveBanner({ stop, conflicts, onContinue, onAbort }: {
  stop: InteractiveStop;
  conflicts: number;
  onContinue: () => void;
  onAbort: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-sky-400/30 bg-sky-500/10 flex flex-col gap-1.5 shrink-0">
      <p className="text-xs font-semibold text-sky-300">
        Rebase interactif — étape {stop.step}/{stop.total}
      </p>
      <p className="text-[11px] text-sky-100/80">
        <span className="font-mono">{stop.short_hash}</span> « {stop.summary} »
      </p>
      <p className="text-[11px] text-sky-100/70">
        {interactiveHint(stop, conflicts)}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onContinue}
          disabled={stop.reason === "conflict" && conflicts > 0}
          className="text-[11px] px-2 py-0.5 rounded bg-green-700/60 hover:bg-green-700/80 text-white disabled:opacity-40"
        >
          Continuer
        </button>
        <button onClick={onAbort} className="text-[11px] px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-800/80 text-white">
          Annuler le rebase
        </button>
      </div>
    </div>
  );
}

const commitInput =
  "w-full bg-shade/30 border border-overlay/10 rounded px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/50 placeholder:text-[var(--color-muted)]";

function FileSection({ title, count, actions, children }: {
  title: string;
  count: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">
          {title} <span className="font-normal opacity-60">{count}</span>
        </span>
        <div className="ml-auto flex gap-1">{actions}</div>
      </div>
      {children}
    </div>
  );
}

const STATUS_BADGE: Record<FileStatus["status"], { letter: string; color: string }> = {
  modified: { letter: "M", color: "text-yellow-400" },
  added: { letter: "A", color: "text-green-400" },
  deleted: { letter: "D", color: "text-red-400" },
  renamed: { letter: "R", color: "text-sky-400" },
  untracked: { letter: "?", color: "text-green-300" },
  conflicted: { letter: "!", color: "text-red-400" },
};

function rowTone(shown: boolean, picked: boolean): string {
  if (picked) return "bg-[var(--color-accent)]/20";
  return shown ? "bg-overlay/10" : "hover:bg-overlay/5";
}

/** Actions de l'en-tête d'une section quand plusieurs de ses fichiers sont sélectionnés, sinon `fallback`. */
function SelectionActions({ files, onClear, fallback, children }: {
  files: FileStatus[];
  onClear: () => void;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (files.length === 0) return fallback;
  return (
    <>
      <span className="text-[10px] text-[var(--color-accent)] self-center">{plural(files.length, "sélectionné")}</span>
      {children}
      <HeaderBtn title="Annuler la sélection" onClick={onClear}>✕</HeaderBtn>
    </>
  );
}

/** Retrait d'une ligne de l'arbre selon sa profondeur. */
const treePadding = (depth: number) => 12 + depth * 12;

/** Arbre de fichiers : un dossier pliable par niveau de chemin, récursivement. */
function FileTree({ nodes, depth, isOpen, onToggle, row, folderActions }: {
  nodes: FileNode<FileStatus>[];
  depth: number;
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  row: (f: FileStatus, depth: number) => React.ReactNode;
  folderActions?: (files: FileStatus[]) => React.ReactNode;
}) {
  return nodes.map((node) => {
    if (node.kind === "file") return row(node.item, depth);
    const open = isOpen(node.path);
    return (
      <div key={`folder:${node.path}`}>
        <div
          className="flex items-center gap-1 pr-3 py-[3px] cursor-pointer group hover:bg-overlay/5"
          style={{ paddingLeft: treePadding(depth) }}
          onClick={() => onToggle(node.path)}
          title={node.path}
        >
          <span className="w-3 shrink-0 text-[9px] text-[var(--color-muted)]">{open ? "▾" : "▸"}</span>
          <span className="flex-1 truncate text-[11px] font-mono text-[var(--color-muted)]">
            {node.name}
            <span className="ml-1.5 opacity-60">{node.files.length}</span>
          </span>
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">{folderActions?.(node.files)}</div>
        </div>
        {open && (
          <FileTree nodes={node.children} depth={depth + 1} isOpen={isOpen} onToggle={onToggle} row={row} folderActions={folderActions} />
        )}
      </div>
    );
  });
}

/** Ligne d'un fichier ; avec `depth` (arborescence), seul le nom est affiché, en retrait. */
function FileRow({ file, depth, shown, picked, onClick, onContextMenu, actions }: {
  file: FileStatus;
  depth?: number;
  /** Fichier affiché au centre. */
  shown: boolean;
  /** Fichier dans la sélection multiple. */
  picked: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  actions?: React.ReactNode;
}) {
  const { letter, color } = STATUS_BADGE[file.status];
  const name = file.path.split("/").pop();
  const dir = depth === undefined ? file.path.slice(0, file.path.length - (name?.length ?? 0)) : "";
  return (
    <div
      className={`flex items-center gap-2 px-3 py-[3px] cursor-pointer select-none group ${rowTone(shown, picked)}`}
      style={depth === undefined ? undefined : { paddingLeft: treePadding(depth) + 16 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.path}
    >
      <span className={`text-[10px] font-bold font-mono w-3 shrink-0 ${color}`}>{letter}</span>
      <span className="flex-1 truncate text-[11px] font-mono">
        <span className="text-[var(--color-text)]">{name}</span>
        {dir && <span className="text-[var(--color-muted)] ml-1.5">{dir}</span>}
      </span>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">{actions}</div>
    </div>
  );
}

function RowBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      className="text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10 rounded w-5 h-5 flex items-center justify-center text-sm font-bold"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function HeaderBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      className="text-[10px] px-1.5 py-0.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SmallBtn({ onClick, disabled, danger, children }: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2 py-0.5 rounded disabled:opacity-40 ${
        danger ? "bg-red-800/60 hover:bg-red-800/80 text-white" : "bg-green-700/60 hover:bg-green-700/80 text-white"
      }`}
    >
      {children}
    </button>
  );
}
