import { useEffect, useState } from "react";
import { useRepoStore, type CenterView } from "../store/useRepoStore";
import { applyLines, getCommitFileDiff, getDiff } from "../ipc/commands";
import { errorMessage, runGit } from "../lib/actions";
import { DiffViewer, type PartialStaging } from "./DiffViewer";
import type { FileDiff } from "../types/git";

type DiffView = Extract<CenterView, { kind: "diff" }>;

function diffSourceLabel(source: DiffView["source"]): string {
  if (source.type === "commit") return `commit ${source.hash.slice(0, 7)}`;
  return source.staged ? "indexé" : "non indexé";
}

export function CenterDiff({ view }: { view: DiffView }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const status = useRepoStore((s) => s.status);
  const setCenter = useRepoStore((s) => s.setCenter);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Le diff de la copie de travail est rechargé quand le statut change (stage, édition…).
  const statusKey = view.source.type === "workdir" ? JSON.stringify(status) : "";

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load =
      view.source.type === "workdir"
        ? getDiff(repoPath, view.path, view.source.staged)
        : getCommitFileDiff(repoPath, view.source.hash, view.path);
    load
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoPath, view, statusKey]);

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
          title="Revenir au graphe (Échap)"
        >
          ← Graphe
        </button>
        <span className="text-xs font-mono text-[var(--color-text)] truncate select-text">{view.path}</span>
        <span className="text-[10px] px-1.5 rounded bg-overlay/10 text-[var(--color-muted)] shrink-0">{sourceLabel}</span>
        {stats && (
          <span className="ml-auto text-[11px] font-mono shrink-0">
            <span className="text-green-400">+{stats.add}</span> <span className="text-red-400">−{stats.del}</span>
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
