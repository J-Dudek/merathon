import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRepoStore, type Comparison } from "../store/useRepoStore";
import { diffCommits } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { CommitFileRow, LineCounts } from "./CommitDetails";
import type { CommitFile, CommitInfo } from "../types/git";

/** Différences entre deux commits du graphe (`git diff base head`), à la place du détail d'un commit. */
export function CompareDetails({ comparison }: { comparison: Comparison }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const center = useRepoStore((s) => s.center);
  const setCenter = useRepoStore((s) => s.setCenter);
  const setComparison = useRepoStore((s) => s.setComparison);
  const { base, head } = comparison;
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setFiles(null);
    setError(null);
    diffCommits(repoPath, base.hash, head.hash)
      .then((f) => !cancelled && setFiles(f))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath, base.hash, head.hash]);

  const source = center.kind === "diff" && center.source.type === "compare" ? center.source : null;
  const selectedPath = source && source.base === base.hash && source.head === head.hash && center.kind === "diff" ? center.path : null;
  const totals = files?.reduce((acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }), { add: 0, del: 0 });

  function close() {
    setComparison(null);
    if (source) setCenter({ kind: "graph" });
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-secondary)] text-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-overlay/10 shrink-0">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">Comparaison</h2>
        <button className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs" title="Fermer la comparaison" aria-label="Fermer la comparaison" onClick={close}>
          <X size={13} />
        </button>
      </div>

      <div className="p-3 border-b border-overlay/10 flex flex-col gap-1.5 text-[11px]">
        <CommitLine label="De" commit={base} />
        <CommitLine label="À" commit={head} />
      </div>

      {error && <p className="p-3 text-xs text-red-400 break-words">{error}</p>}
      {!files && !error && <p className="p-3 text-xs text-[var(--color-muted)]">Chargement…</p>}

      {files && (
        <div className="flex-1 overflow-y-auto">
          <h3 className="px-3 pt-2 pb-1 flex items-center text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">
            {files.length} fichier{files.length > 1 ? "s" : ""}
            {totals && (
              <span className="ml-auto font-mono normal-case tracking-normal font-normal">
                <span className="sr-only"> : </span>
                <LineCounts add={totals.add} del={totals.del} all />
              </span>
            )}
          </h3>
          {files.length === 0 && <p className="px-3 py-1 text-xs text-[var(--color-muted)] italic">Contenu identique</p>}
          {files.map((f) => (
            <CommitFileRow
              key={f.path}
              file={f}
              selected={selectedPath === f.path}
              onClick={() => setCenter({ kind: "diff", path: f.path, source: { type: "compare", base: base.hash, head: head.hash } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommitLine({ label, commit }: { label: string; commit: CommitInfo }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-5 shrink-0 text-[var(--color-muted)]">{label}</span>
      <button
        className="font-mono text-[var(--color-accent-text)] hover:underline shrink-0"
        title="Copier le hash complet"
        aria-label={`${commit.short_hash}, copier le hash complet`}
        onClick={() => navigator.clipboard.writeText(commit.hash)}
      >
        {commit.short_hash}
      </button>
      <span className="truncate text-[var(--color-text)]" title={commit.message}>{commit.message}</span>
    </div>
  );
}
