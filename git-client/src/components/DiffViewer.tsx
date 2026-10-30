import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  /** Barre de recherche dans le fichier (Ctrl+F depuis le diff). */
  searchable?: boolean;
}

/** Occurrence de la recherche : bloc, ligne dans le bloc, position dans le contenu. */
interface Match {
  hunk: number;
  line: number;
  start: number;
}

/** Occurrences de `query` dans le contenu des lignes, sans tenir compte de la casse. */
export function findMatches(diff: FileDiff | null, query: string): Match[] {
  const q = query.toLowerCase();
  if (!diff || !q) return [];
  const matches: Match[] = [];
  diff.hunks.forEach((hunk, h) => hunk.lines.forEach((line, l) => {
    const content = line.content.toLowerCase();
    for (let i = content.indexOf(q); i !== -1; i = content.indexOf(q, i + q.length)) matches.push({ hunk: h, line: l, start: i });
  }));
  return matches;
}

interface Selection {
  hunk: number;
  lines: Set<number>;
  anchor: number;
}

export function DiffViewer({ diff, loading, staging, annotations, searchable }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [applying, setApplying] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Recherche calculée en différé : la saisie reste fluide sur un gros diff.
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(() => findMatches(diff, deferredQuery), [diff, deferredQuery]);
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;
  /** Occurrences par ligne (« bloc:ligne ») : tableaux stables tant que la recherche ne change pas. */
  const byLine = useMemo(() => {
    const map = new Map<string, Highlight[]>();
    matches.forEach((m, index) => {
      const key = `${m.hunk}:${m.line}`;
      const list = map.get(key);
      if (list) list.push({ start: m.start, index });
      else map.set(key, [{ start: m.start, index }]);
    });
    return map;
  }, [matches]);
  const activeKey = active >= 0 ? `${matches[active].hunk}:${matches[active].line}` : null;

  useEffect(() => setSelection(null), [diff]);
  // Nouveau fichier ou nouvelle recherche : on repart de la première occurrence.
  useEffect(() => setCurrent(0), [diff, deferredQuery]);
  useEffect(() => {
    if (active < 0) return;
    scrollRef.current?.querySelector(`[data-match="${active}"]`)?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [active, matches]);

  // Stable : les lignes mémoïsées ne sont re-rendues que si leurs propres props changent.
  const toggleLine = useCallback((hunk: number, index: number, line: DiffLine, shift: boolean) => {
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
  }, [diff, staging]);

  function step(delta: number) {
    if (matches.length) setCurrent((active + delta + matches.length) % matches.length);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (searchable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }

  const searchBar = searchable && (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-overlay/5 font-sans">
      <div className="relative flex-1 min-w-0 max-w-72">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          className="w-full bg-shade/30 border border-overlay/50 rounded pl-6 pr-2 py-0.5 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60 placeholder:text-[var(--color-muted)]"
          placeholder="Rechercher dans le fichier (Ctrl+F)"
          aria-label="Rechercher dans le fichier"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape" && query) {
              // Échap vide la recherche avant de fermer la fenêtre.
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
      </div>
      {query && (
        <>
          <span role="status" className="text-[10px] text-[var(--color-muted)] tabular-nums shrink-0">
            {matches.length ? `${active + 1}/${matches.length}` : "Aucun résultat"}
          </span>
          <SearchBtn label="Occurrence précédente (Maj+Entrée)" disabled={!matches.length} onClick={() => step(-1)}>
            <ChevronUp size={12} />
          </SearchBtn>
          <SearchBtn label="Occurrence suivante (Entrée)" disabled={!matches.length} onClick={() => step(1)}>
            <ChevronDown size={12} />
          </SearchBtn>
        </>
      )}
    </div>
  );

  if (loading) {
    return <div className="p-3 text-xs text-[var(--color-muted)]">Chargement…</div>;
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

  const selectedCount = selection?.lines.size ?? 0;

  return (
    <div className="relative h-full flex flex-col" onKeyDown={onKeyDown}>
      {searchBar}
      {/* Zone défilante atteignable au clavier : les flèches font défiler le diff. */}
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label={`Différences de ${diff.path}`}
        className="flex-1 overflow-auto font-mono text-[11px] leading-5 select-text outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/60"
      >
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
              <DiffHeader annotations={!!annotations} />
              <tbody>
                {hunk.lines.map((line, j) => {
                  const highlights = byLine.get(`${i}:${j}`);
                  return (
                    <DiffLineRow
                      key={j}
                      line={line}
                      hunk={i}
                      index={j}
                      selectable={!!staging && line.kind !== "context"}
                      selected={selection?.hunk === i && selection.lines.has(j)}
                      onToggle={toggleLine}
                      annotated={!!annotations}
                      // Contenu calculé ici : une ligne sans commentaire reçoit null et n'est pas re-rendue.
                      below={annotations?.below(line) ?? null}
                      onComment={annotations?.onComment}
                      highlights={highlights}
                      // Seules les lignes concernées reçoivent des valeurs qui changent : les autres ne sont pas re-rendues.
                      current={activeKey === `${i}:${j}` ? active : -1}
                      queryLength={highlights ? deferredQuery.length : 0}
                    />
                  );
                })}
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
          <button
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
            onClick={() => setSelection(null)}
            title="Annuler la sélection"
            aria-label="Annuler la sélection"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function SearchBtn({ label, disabled, onClick, children }: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10 disabled:opacity-40"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Occurrence de la recherche dans une ligne, avec son rang parmi toutes les occurrences. */
interface Highlight {
  start: number;
  index: number;
}

/** Contenu d'une ligne, occurrences de la recherche surlignées. */
function Highlighted({ content, highlights, current, length }: {
  content: string;
  highlights?: Highlight[];
  current: number;
  length: number;
}) {
  if (!highlights) return <>{content}</>;
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const h of highlights) {
    parts.push(content.slice(from, h.start));
    parts.push(
      <mark
        key={h.index}
        data-match={h.index}
        aria-current={h.index === current ? "true" : undefined}
        className={`rounded-sm text-inherit ${h.index === current ? "bg-amber-400/70 outline outline-1 outline-amber-300" : "bg-amber-400/30"}`}
      >
        {content.slice(h.start, h.start + length)}
      </mark>,
    );
    from = h.start + length;
  }
  parts.push(content.slice(from));
  return <>{parts}</>;
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

/** En-têtes des colonnes, annoncés par les lecteurs d'écran (RGAA 5.6) ; ligne sans hauteur à l'écran. */
function DiffHeader({ annotations }: { annotations: boolean }) {
  const columns = ["Sélection", ...(annotations ? ["Commentaire"] : []), "Ancienne ligne", "Nouvelle ligne", "Contenu"];
  return (
    <thead>
      <tr className="h-0">
        {columns.map((c) => (
          <th key={c} scope="col" className="p-0 h-0 font-normal">
            <span className="sr-only">{c}</span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

const DiffLineRow = memo(function DiffLineRow({ line, hunk, index, selectable, selected, onToggle, annotated, below, onComment, highlights, current, queryLength }: {
  line: DiffLine;
  hunk: number;
  index: number;
  highlights?: Highlight[];
  /** Rang de l'occurrence courante si elle est sur cette ligne, sinon -1. */
  current: number;
  queryLength: number;
  selectable: boolean;
  selected: boolean;
  onToggle: (hunk: number, index: number, line: DiffLine, shift: boolean) => void;
  /** Colonne de commentaire affichée (diff de PR / MR). */
  annotated: boolean;
  /** Fils, brouillons ou formulaire sous la ligne. */
  below: React.ReactNode;
  onComment?: (line: DiffLine) => void;
}) {
  const { bg, text, prefix } = lineStyle(line.kind);

  return (
    <>
      <tr
        className={`group ${selected ? "bg-sky-800/50" : bg} ${selectable ? "cursor-pointer hover:brightness-125" : ""}`}
        onClick={(e) => selectable && onToggle(hunk, index, line, e.shiftKey)}
        title={selectable ? "Clic : sélectionner la ligne · Maj+clic : plage" : undefined}
      >
        <td className={`w-1.5 p-0 ${selected ? "bg-sky-400" : ""}`}>
          {/* Sélection au clavier : Espace (Maj+Espace pour une plage) ; le clic sur la ligne fait de même. */}
          {selectable && (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Sélectionner la ligne ${lineLabel(line)}`}
              className="block w-full h-5 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(hunk, index, line, e.shiftKey);
              }}
            />
          )}
        </td>
        {annotated && (
          <td className="w-5 select-none">
            {onComment && (
              <button
                className="w-4 h-4 leading-none rounded bg-[var(--color-accent-solid)] text-white font-sans font-bold opacity-0 group-hover:opacity-100 focus:opacity-100"
                title="Commenter cette ligne"
                aria-label={`Commenter la ligne ${lineLabel(line)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onComment(line);
                }}
              >
                <Plus size={12} strokeWidth={2.5} className="mx-auto" />
              </button>
            )}
          </td>
        )}
        <td className="w-10 text-right pr-2 select-none text-[var(--color-muted)] border-r border-overlay/5">
          {line.old_lineno ?? ""}
        </td>
        <td className="w-10 text-right pr-2 select-none text-[var(--color-muted)] border-r border-overlay/5">
          {line.new_lineno ?? ""}
        </td>
        <td className={`pl-2 pr-4 whitespace-pre ${text}`}>
          <span className="select-none mr-1 opacity-70" aria-hidden>{prefix}</span>
          {line.kind !== "context" && <span className="sr-only">{line.kind === "added" ? "Ajoutée : " : "Supprimée : "}</span>}
          <Highlighted content={line.content} highlights={highlights} current={current} length={queryLength} />
        </td>
      </tr>
      {below && (
        <tr>
          <td colSpan={annotated ? 5 : 4} className="px-3 py-1.5 bg-shade/30 border-y border-overlay/5 font-sans text-xs whitespace-normal">
            {below}
          </td>
        </tr>
      )}
    </>
  );
});

/** Ligne désignée par son numéro dans la version où elle existe. */
function lineLabel(line: DiffLine): string {
  if (line.kind === "removed") return `supprimée ${line.old_lineno}`;
  return line.kind === "added" ? `ajoutée ${line.new_lineno}` : `${line.new_lineno}`;
}

function lineStyle(kind: DiffLine["kind"]) {
  switch (kind) {
    case "added":   return { bg: "bg-green-950/40",  text: "text-green-300",  prefix: "+" };
    case "removed": return { bg: "bg-red-950/40",    text: "text-red-300",    prefix: "-" };
    default:        return { bg: "",                  text: "text-[var(--color-text)]", prefix: " " };
  }
}
