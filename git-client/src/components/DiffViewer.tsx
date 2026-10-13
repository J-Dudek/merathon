import { useEffect, useState } from "react";
import type { FileDiff, DiffLine } from "../types/git";
import type { LineAction } from "../ipc/commands";

/** Actions d'indexation partielle disponibles selon le côté affiché. */
export interface PartialStaging {
  side: "unstaged" | "staged";
  /** `lines` null : tout le bloc. */
  onApply: (hunk: number, lines: number[] | null, action: LineAction) => Promise<void>;
}

/** Commentaires de revue attachés aux lignes (diff d'une pull request). */
export interface DiffAnnotations {
  /** Contenu affiché sous la ligne (fils, brouillons, formulaire), ou null. */
  below: (line: DiffLine) => React.ReactNode;
  /** Ouvre le formulaire de commentaire sur la ligne ; absent : lecture seule. */
  onComment?: (line: DiffLine) => void;
}

interface Props {
  diff: FileDiff | null;
  loading: boolean;
  staging?: PartialStaging;
  annotations?: DiffAnnotations;
}

interface Selection {
  hunk: number;
  lines: Set<number>;
  anchor: number;
}

export function DiffViewer({ diff, loading, staging, annotations }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => setSelection(null), [diff]);

  if (loading) {
    return <div className="p-3 text-xs text-[var(--color-muted)] animate-pulse">Chargement…</div>;
  }
  if (!diff) {
    return <div className="p-3 text-xs text-[var(--color-muted)] italic">Sélectionne un fichier</div>;
  }
  if (diff.is_binary) {
    return <div className="p-3 text-xs text-[var(--color-muted)] italic">Fichier binaire</div>;
  }
  if (diff.hunks.length === 0) {
    return <div className="p-3 text-xs text-[var(--color-muted)] italic">Aucune différence</div>;
  }

  async function apply(hunk: number, lines: number[] | null, action: LineAction) {
    if (!staging) return;
    setApplying(true);
    try {
      await staging.onApply(hunk, lines, action);
      setSelection(null);
    } finally {
      setApplying(false);
    }
  }

  function toggleLine(hunk: number, index: number, line: DiffLine, shift: boolean) {
    if (!staging || line.kind === "context") return;
    setSelection((prev) => {
      if (shift && prev && prev.hunk === hunk) {
        // Sélection d'une plage de lignes modifiées depuis l'ancre
        const [from, to] = [Math.min(prev.anchor, index), Math.max(prev.anchor, index)];
        const lines = new Set(prev.lines);
        diff!.hunks[hunk].lines.forEach((l, i) => {
          if (i >= from && i <= to && l.kind !== "context") lines.add(i);
        });
        return { ...prev, lines };
      }
      const lines = prev && prev.hunk === hunk ? new Set(prev.lines) : new Set<number>();
      if (lines.has(index)) lines.delete(index);
      else lines.add(index);
      return lines.size ? { hunk, lines, anchor: index } : null;
    });
  }

  const selectedCount = selection?.lines.size ?? 0;

  return (
    <div className="relative h-full flex flex-col">
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-5 select-text">
        {diff.hunks.map((hunk, i) => (
          <div key={i}>
            <div className="flex items-center gap-2 px-2 py-0.5 bg-[var(--color-bg-info)] text-[var(--color-info)] border-y border-overlay/5 sticky top-0 z-10">
              <span className="truncate flex-1">{hunk.header}</span>
              {staging && (
                <div className="flex gap-1 font-sans shrink-0">
                  {staging.side === "unstaged" ? (
                    <>
                      <HunkBtn danger disabled={applying} onClick={() => apply(i, null, "discard")}>Annuler le bloc</HunkBtn>
                      <HunkBtn disabled={applying} onClick={() => apply(i, null, "stage")}>Indexer le bloc</HunkBtn>
                    </>
                  ) : (
                    <HunkBtn disabled={applying} onClick={() => apply(i, null, "unstage")}>Désindexer le bloc</HunkBtn>
                  )}
                </div>
              )}
            </div>
            <table className="w-full border-collapse">
              <tbody>
                {hunk.lines.map((line, j) => (
                  <DiffLineRow
                    key={j}
                    line={line}
                    selectable={!!staging && line.kind !== "context"}
                    selected={selection?.hunk === i && selection.lines.has(j)}
                    onToggle={(shift) => toggleLine(i, j, line, shift)}
                    annotations={annotations}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {staging && selection && selectedCount > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-overlay/15 shadow-xl text-xs">
          <span className="text-[var(--color-muted)]">
            {selectedCount} ligne{selectedCount > 1 ? "s" : ""} sélectionnée{selectedCount > 1 ? "s" : ""}
          </span>
          {staging.side === "unstaged" ? (
            <>
              <HunkBtn danger disabled={applying} onClick={() => apply(selection.hunk, [...selection.lines], "discard")}>Annuler</HunkBtn>
              <HunkBtn disabled={applying} onClick={() => apply(selection.hunk, [...selection.lines], "stage")}>Indexer les lignes</HunkBtn>
            </>
          ) : (
            <HunkBtn disabled={applying} onClick={() => apply(selection.hunk, [...selection.lines], "unstage")}>Désindexer les lignes</HunkBtn>
          )}
          <button className="text-[var(--color-muted)] hover:text-[var(--color-text)]" onClick={() => setSelection(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

function HunkBtn({ onClick, disabled, danger, children }: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-[10px] px-2 py-0.5 rounded disabled:opacity-40 ${
        danger ? "text-red-300 hover:bg-red-900/40" : "bg-overlay/10 text-[var(--color-text)] hover:bg-overlay/20"
      }`}
    >
      {children}
    </button>
  );
}

function DiffLineRow({ line, selectable, selected, onToggle, annotations }: {
  line: DiffLine;
  selectable: boolean;
  selected: boolean;
  onToggle: (shift: boolean) => void;
  annotations?: DiffAnnotations;
}) {
  const { bg, text, prefix } = lineStyle(line.kind);
  const below = annotations?.below(line);
  const onComment = annotations?.onComment;

  return (
    <>
      <tr
        className={`group ${selected ? "bg-sky-800/50" : bg} ${selectable ? "cursor-pointer hover:brightness-125" : ""}`}
        onClick={(e) => selectable && onToggle(e.shiftKey)}
        title={selectable ? "Clic : sélectionner la ligne · Maj+clic : plage" : undefined}
      >
        <td className={`w-1 ${selected ? "bg-sky-400" : ""}`} />
        {annotations && (
          <td className="w-5 select-none">
            {onComment && (
              <button
                className="w-4 h-4 leading-none rounded bg-[var(--color-accent)] text-white font-sans font-bold opacity-0 group-hover:opacity-100 focus:opacity-100"
                title="Commenter cette ligne"
                aria-label="Commenter cette ligne"
                onClick={(e) => {
                  e.stopPropagation();
                  onComment(line);
                }}
              >
                +
              </button>
            )}
          </td>
        )}
        <td className="w-10 text-right pr-2 select-none text-[var(--color-muted)] opacity-50 border-r border-overlay/5">
          {line.old_lineno ?? ""}
        </td>
        <td className="w-10 text-right pr-2 select-none text-[var(--color-muted)] opacity-50 border-r border-overlay/5">
          {line.new_lineno ?? ""}
        </td>
        <td className={`pl-2 pr-4 whitespace-pre ${text}`}>
          <span className="select-none mr-1 opacity-70">{prefix}</span>
          {line.content}
        </td>
      </tr>
      {below && (
        <tr>
          <td colSpan={annotations ? 5 : 4} className="px-3 py-1.5 bg-shade/30 border-y border-overlay/5 font-sans text-xs whitespace-normal">
            {below}
          </td>
        </tr>
      )}
    </>
  );
}

function lineStyle(kind: DiffLine["kind"]) {
  switch (kind) {
    case "added":   return { bg: "bg-green-950/40",  text: "text-green-300",  prefix: "+" };
    case "removed": return { bg: "bg-red-950/40",    text: "text-red-300",    prefix: "-" };
    default:        return { bg: "",                  text: "text-[var(--color-text)]", prefix: " " };
  }
}
