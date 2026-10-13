import { useEffect, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { getCommitDetails } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import type { CommitDetails as Details, CommitFile, CommitInfo } from "../types/git";

const STATUS_LETTER: Record<CommitFile["status"], { letter: string; color: string }> = {
  added: { letter: "A", color: "text-green-400" },
  modified: { letter: "M", color: "text-yellow-400" },
  deleted: { letter: "D", color: "text-red-400" },
  renamed: { letter: "R", color: "text-sky-400" },
  copied: { letter: "C", color: "text-sky-400" },
  typechange: { letter: "T", color: "text-purple-400" },
};

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function CommitDetails({ commit }: { commit: CommitInfo }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const commits = useRepoStore((s) => s.commits);
  const center = useRepoStore((s) => s.center);
  const setCenter = useRepoStore((s) => s.setCenter);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setDetails(null);
    setError(null);
    getCommitDetails(repoPath, commit.hash)
      .then((d) => !cancelled && setDetails(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath, commit.hash]);

  const body = details?.message.slice(details.summary.length).trim();
  const selectedPath =
    center.kind === "diff" && center.source.type === "commit" && center.source.hash === commit.hash ? center.path : null;
  const totals = details?.files.reduce((acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }), { add: 0, del: 0 });

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-secondary)] text-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-overlay/10 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">Commit</span>
        <button
          className="font-mono text-[11px] text-[var(--color-accent)] hover:underline"
          title="Copier le hash complet"
          onClick={() => navigator.clipboard.writeText(commit.hash)}
        >
          {commit.short_hash}
        </button>
        <button
          className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs"
          title="Fermer et revenir aux modifications en cours"
          onClick={() => {
            setSelectedCommit(null);
            if (center.kind === "diff" && center.source.type === "commit") setCenter({ kind: "graph" });
          }}
        >
          ✕
        </button>
      </div>

      {error && <p className="p-3 text-xs text-red-400 break-words">{error}</p>}
      {!details && !error && <p className="p-3 text-xs text-[var(--color-muted)] animate-pulse">Chargement…</p>}

      {details && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 border-b border-overlay/10 flex flex-col gap-2">
            <p className="text-sm text-[var(--color-text)] font-medium break-words select-text">{details.summary}</p>
            {body && <pre className="text-xs text-[var(--color-muted)] whitespace-pre-wrap break-words font-sans select-text">{body}</pre>}

            <div className="text-[11px] text-[var(--color-muted)] flex flex-col gap-0.5 select-text">
              <span>
                <span className="text-[var(--color-text)]">{details.author}</span> &lt;{details.email}&gt;
              </span>
              <span>Écrit le {formatDate(details.author_time)}</span>
              {(details.committer !== details.author || details.commit_time !== details.author_time) && (
                <span>Commité par {details.committer} le {formatDate(details.commit_time)}</span>
              )}
            </div>

            {details.parents.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap text-[11px] text-[var(--color-muted)]">
                {details.parents.length > 1 ? "Parents" : "Parent"} :
                {details.parents.map((p) => {
                  const parent = commits.find((c) => c.hash === p);
                  return (
                    <button
                      key={p}
                      className="font-mono text-[var(--color-accent)] hover:underline disabled:no-underline disabled:text-[var(--color-muted)]"
                      disabled={!parent}
                      onClick={() => parent && setSelectedCommit(parent)}
                    >
                      {p.slice(0, 7)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-3 pt-2 pb-1 flex items-center text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">
            {details.files.length} fichier{details.files.length > 1 ? "s" : ""}
            {totals && (
              <span className="ml-auto font-mono normal-case tracking-normal font-normal">
                <span className="text-green-400">+{totals.add}</span> <span className="text-red-400">−{totals.del}</span>
              </span>
            )}
          </div>
          {details.files.map((f) => {
            const { letter, color } = STATUS_LETTER[f.status];
            return (
              <div
                key={f.path}
                className={`flex items-center gap-2 px-3 py-[3px] cursor-pointer ${
                  selectedPath === f.path ? "bg-overlay/10" : "hover:bg-overlay/5"
                }`}
                title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}
                onClick={() => setCenter({ kind: "diff", path: f.path, source: { type: "commit", hash: commit.hash } })}
              >
                <span className={`text-[10px] font-bold font-mono w-3 shrink-0 ${color}`}>{letter}</span>
                <span className="flex-1 truncate text-left text-[11px] font-mono text-[var(--color-text)]" dir="rtl">
                  <bdi>{f.path}</bdi>
                </span>
                <span className="text-[10px] font-mono shrink-0">
                  {f.additions > 0 && <span className="text-green-400">+{f.additions}</span>}
                  {f.deletions > 0 && <span className="text-red-400 ml-1">−{f.deletions}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
