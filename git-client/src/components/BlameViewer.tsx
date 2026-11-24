import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRepoStore, type CenterView } from "../store/useRepoStore";
import { blameFile } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import type { BlameHunk, FileBlame } from "../types/git";
import { tr, locale } from "../i18n";

type BlameView = Extract<CenterView, { kind: "blame" }>;

/**
 * Teinte d'une plage selon son âge : `recency` va de 0 (la plus ancienne du fichier) à 1 (la plus récente).
 * Plus c'est récent, plus c'est clair ; plus c'est ancien, plus c'est foncé.
 */
export function ageColor(recency: number, alpha = 1): string {
  const t = Math.min(1, Math.max(0, recency));
  return `hsl(210 60% ${Math.round(22 + t * 50)}% / ${alpha})`;
}

/** Position de `timestamp` entre la plus ancienne (0) et la plus récente (1) des dates ; 1 si elles sont toutes égales. */
export function recencyOf(timestamp: number, oldest: number, newest: number): number {
  return newest > oldest ? (timestamp - oldest) / (newest - oldest) : 1;
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(locale, { dateStyle: "medium" });
}

/** Contenu d'un fichier avec, devant chaque plage de lignes, le commit, l'auteur et la date qui les ont introduites. */
export function BlameViewer({ view }: { view: BlameView }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const commits = useRepoStore((s) => s.commits);
  const setCenter = useRepoStore((s) => s.setCenter);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);
  const [blame, setBlame] = useState<FileBlame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBlame(null);
    blameFile(repoPath, view.path, view.rev)
      .then((b) => !cancelled && setBlame(b))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoPath, view.path, view.rev]);

  const hunkByLine = useMemo(() => {
    const map = new Map<number, BlameHunk>();
    for (const h of blame?.hunks ?? []) map.set(h.start_line, h);
    return map;
  }, [blame]);

  function showCommit(hash: string) {
    const commit = commits.find((c) => c.hash === hash);
    if (!commit) return;
    setSelectedCommit(commit);
    setCenter({ kind: "graph" });
  }

  const dated = (blame?.hunks ?? []).filter((h) => h.hash);
  const oldest = Math.min(...dated.map((h) => h.timestamp));
  const newest = Math.max(...dated.map((h) => h.timestamp));
  const revLabel = view.rev ? `commit ${view.rev.slice(0, 7)}` : tr("copie de travail");
  const lines = blame?.lines ?? [];
  // Numéro de ligne → hunk qui la couvre, pour teinter et séparer les plages.
  const owner: (BlameHunk | undefined)[] = [];
  for (const h of blame?.hunks ?? []) for (let i = 0; i < h.line_count; i++) owner[h.start_line - 1 + i] = h;

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
        <span className="text-[10px] px-1.5 rounded bg-overlay/10 text-[var(--color-muted)] shrink-0">{tr("Blame · {rev}", { rev: revLabel })}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {error && <p className="p-3 text-xs text-red-400 break-words">{error}</p>}
        {!error && loading && <p className="p-3 text-xs text-[var(--color-muted)]">{tr("Chargement…")}</p>}
        {!error && !loading && (
          <table className="w-full border-collapse font-mono text-[11px]" aria-label={tr("Blame de {path}", { path: view.path })}>
            <tbody>
              {lines.map((text, i) => {
                const n = i + 1;
                const hunk = owner[i];
                const first = hunk ? hunkByLine.get(n) : undefined;
                const recency = hunk?.hash ? recencyOf(hunk.timestamp, oldest, newest) : null;
                return (
                  <tr key={n} className={first && n > 1 ? "border-t border-overlay/10" : undefined}>
                    <td
                      className="w-[22rem] max-w-[22rem] min-w-[22rem] px-2 align-top whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{
                        borderLeft: `4px solid ${recency === null ? "transparent" : ageColor(recency)}`,
                        backgroundColor: recency === null ? undefined : ageColor(recency, 0.18),
                      }}
                    >
                      {first &&
                        (first.hash ? (
                          <button
                            type="button"
                            className="flex w-full gap-2 text-left text-[var(--color-muted)] hover:text-[var(--color-text)]"
                            title={`${first.hash}\n${first.author} <${first.email}>\n${formatDate(first.timestamp)}\n${first.summary}`}
                            onClick={() => showCommit(first.hash)}
                          >
                            <span className="text-[var(--color-accent)] shrink-0">{first.short_hash}</span>
                            <span className="truncate flex-1">{first.author}</span>
                            <span className="shrink-0">{formatDate(first.timestamp)}</span>
                          </button>
                        ) : (
                          <span className="italic text-[var(--color-muted)]">{tr("Pas encore commité")}</span>
                        ))}
                    </td>
                    <td className="w-12 px-2 text-right align-top text-[var(--color-muted)] select-none">{n}</td>
                    <td className="px-2 whitespace-pre select-text">{text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
