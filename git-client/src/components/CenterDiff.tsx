import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useRepoStore, type CenterView } from "../store/useRepoStore";
import { applyLines, getCommitFileDiff, getCompareFileDiff, getDiff } from "../ipc/commands";
import { errorMessage, runGit } from "../lib/actions";
import { DiffViewer, type PartialStaging } from "./DiffViewer";
import { LineCounts } from "./CommitDetails";
import type { FileDiff } from "../types/git";
import { tr } from "../i18n";

type DiffView = Extract<CenterView, { kind: "diff" }>;

function diffSourceLabel(source: DiffView["source"]): string {
  if (source.type === "commit") return `commit ${source.hash.slice(0, 7)}`;
  if (source.type === "compare") return `${source.base.slice(0, 7)} → ${source.head.slice(0, 7)}`;
  return source.staged ? tr("indexé") : tr("non indexé");
}

function sameDiff(a: FileDiff, b: FileDiff): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function CenterDiff({ view }: { view: DiffView }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const status = useRepoStore((s) => s.status);
  const setCenter = useRepoStore((s) => s.setCenter);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Le diff de la copie de travail est rechargé à chaque relecture du statut (stage, édition…), même quand le
  // statut est inchangé : un fichier déjà « modifié » peut l'être encore. Le diff précédent reste affiché pendant
  // le rechargement, le défilement est donc conservé.
  const workdirVersion = useRepoStore((s) => s.workdirVersion);
  const reloadKey = view.source.type === "workdir" ? workdirVersion : 0;

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { source } = view;
    let load: Promise<FileDiff>;
    if (source.type === "workdir") load = getDiff(repoPath, view.path, source.staged);
    else if (source.type === "compare") load = getCompareFileDiff(repoPath, source.base, source.head, view.path);
    else load = getCommitFileDiff(repoPath, source.hash, view.path);
    load
      // Contenu identique : on garde l'objet affiché, pour ne pas perdre la sélection de lignes ni la recherche.
      .then((d) => !cancelled && setDiff((prev) => (prev && sameDiff(prev, d) ? prev : d)))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoPath, view, reloadKey]);

  const sourceLabel = diffSourceLabel(view.source);

  // Indexation partielle : uniquement pour un fichier modifié de la copie de travail.
  let staging: PartialStaging | undefined;
  if (view.source.type === "workdir" && repoPath) {
    const staged = view.source.staged;
    const entry = status.find((f) => f.path === view.path && f.staged === staged);
    if (entry?.status === "modified") {
      staging = {
        side: staged ? "staged" : "unstaged",
        onApply: async (hunk, lines, action) => {
          await runGit(() => applyLines(repoPath, view.path, hunk, lines, action));
          // Plus rien de ce côté : on bascule sur l'autre côté du fichier s'il en reste.
          const after = useRepoStore.getState().status.filter((f) => f.path === view.path);
          if (!after.some((f) => f.staged === staged)) {
            const other = after.find((f) => f.staged !== staged);
            setCenter(other ? { kind: "diff", path: view.path, source: { type: "workdir", staged: other.staged } } : { kind: "graph" });
          }
        },
      };
    }
  }

  const stats = diff?.hunks.reduce(
    (acc, h) => {
      for (const l of h.lines) {
        if (l.kind === "added") acc.add++;
        if (l.kind === "removed") acc.del++;
      }
      return acc;
    },
    { add: 0, del: 0 },
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 h-9 shrink-0 border-b border-overlay/10 bg-[var(--color-bg-secondary)]">
        <button
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          onClick={() => setCenter({ kind: "graph" })}
          title={tr("Revenir au graphe (Échap)")}
        >
          <ArrowLeft size={12} className="inline mr-1 -mt-0.5" />{tr("Graphe")}
        </button>
        <span className="text-xs font-mono text-[var(--color-text)] truncate select-text">{view.path}</span>
        <span className="text-[10px] px-1.5 rounded bg-overlay/10 text-[var(--color-muted)] shrink-0">{sourceLabel}</span>
        {stats && (
          <span className="ml-auto text-[11px] font-mono shrink-0">
            <LineCounts add={stats.add} del={stats.del} all />
          </span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {error ? (
          <p className="p-3 text-xs text-red-400 break-words">{error}</p>
        ) : (
          <DiffViewer diff={diff} loading={loading && !diff} staging={staging} />
        )}
      </div>
    </div>
  );
}
