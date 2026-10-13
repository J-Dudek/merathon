import { useState, useEffect } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import { getConflictContent, resolveConflict } from "../ipc/commands";
import { errorMessage } from "../lib/actions";

export type Resolution = "ours" | "theirs" | "both";

interface ConflictBlock {
  ours: string[];
  theirs: string[];
}

interface ConflictSection extends ConflictBlock {
  /** Jusqu'à 3 lignes de contexte avant le bloc. */
  before: string[];
}

/**
 * Parcourt un fichier en conflit : `onText` reçoit les lignes hors conflit, `onConflict` chaque
 * bloc `<<<<<<< … ======= … >>>>>>>` complet. Analyse et résolution partagent ainsi le même découpage.
 */
function walkConflicts(content: string, onText: (line: string) => void, onConflict: (block: ConflictBlock) => void) {
  let state: "normal" | "ours" | "theirs" = "normal";
  let block: ConflictBlock = { ours: [], theirs: [] };

  for (const line of content.split("\n")) {
    if (state === "normal" && line.startsWith("<<<<<<<")) {
      block = { ours: [], theirs: [] };
      state = "ours";
    } else if (state === "ours" && line.startsWith("=======")) {
      state = "theirs";
    } else if (state === "theirs" && line.startsWith(">>>>>>>")) {
      onConflict(block);
      state = "normal";
    } else if (state === "normal") {
      onText(line);
    } else {
      block[state].push(line);
    }
  }
}

export function parseConflicts(content: string): ConflictSection[] {
  const sections: ConflictSection[] = [];
  let context: string[] = [];
  walkConflicts(
    content,
    (line) => context.push(line),
    (block) => {
      sections.push({ ...block, before: context.slice(-3) });
      context = [];
    },
  );
  return sections;
}

export function resolveWith(content: string, choices: Resolution[]): string {
  const result: string[] = [];
  let index = 0;
  walkConflicts(
    content,
    (line) => result.push(line),
    ({ ours, theirs }) => {
      const choice = choices[index++] ?? "ours";
      if (choice !== "theirs") result.push(...ours);
      if (choice !== "ours") result.push(...theirs);
    },
  );
  return result.join("\n");
}

function resolveLabel(saving: boolean, hasConflicts: boolean): string {
  if (saving) return "Résolution…";
  return hasConflicts ? "Résoudre et indexer" : "Marquer comme résolu";
}

export function ConflictViewer({ path }: { path: string }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const refresh = useRepoStore((s) => s.refresh);
  const setCenter = useRepoStore((s) => s.setCenter);
  const notify = useUiStore((s) => s.notify);
  const [content, setContent] = useState<string | null>(null);
  const [sections, setSections] = useState<ConflictSection[]>([]);
  const [choices, setChoices] = useState<Resolution[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    setContent(null);
    setError(null);
    getConflictContent(repoPath, path)
      .then((c) => {
        setContent(c);
        const s = parseConflicts(c);
        setSections(s);
        setChoices(s.map(() => "ours"));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [repoPath, path]);

  async function handleResolve() {
    if (!repoPath || content === null) return;
    setSaving(true);
    try {
      await resolveConflict(repoPath, path, resolveWith(content, choices));
      notify("success", `${path} résolu et indexé`);
      setCenter({ kind: "graph" });
      await refresh();
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return <div className="p-3 text-xs text-red-400 break-words">{error}</div>;
  }
  if (content === null) {
    return <div className="p-3 text-xs text-[var(--color-muted)] animate-pulse">Chargement du conflit…</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-3 h-9 border-b border-overlay/10 shrink-0 bg-[var(--color-bg-secondary)]">
        <button
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          onClick={() => setCenter({ kind: "graph" })}
        >
          ← Graphe
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">⚠ Conflit</span>
        <span className="text-xs font-mono text-[var(--color-text)] truncate flex-1">{path}</span>
        <span className="text-[11px] text-[var(--color-muted)]">
          {sections.length} bloc{sections.length > 1 ? "s" : ""} — clique sur la version à garder
        </span>
        <button
          className="text-xs px-3 py-1 rounded bg-green-700/70 hover:bg-green-700 text-white disabled:opacity-40"
          onClick={handleResolve}
          disabled={saving}
        >
          {resolveLabel(saving, sections.length > 0)}
        </button>
      </div>

      {sections.length === 0 && (
        <p className="p-3 text-xs text-[var(--color-muted)]">
          Aucun marqueur de conflit dans ce fichier (déjà édité, ou conflit de suppression). Tu peux le marquer comme résolu.
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sections.map((section, i) => (
          <div key={i} className="border border-overlay/10 rounded overflow-hidden text-[11px] font-mono">
            {section.before.length > 0 && (
              <div className="px-3 py-1 bg-shade/20 text-[var(--color-muted)] opacity-60">
                {section.before.map((l, j) => <div key={j} className="whitespace-pre">{l || " "}</div>)}
              </div>
            )}
            <div className="grid grid-cols-2 divide-x divide-overlay/10">
              <SidePanel
                label="Actuel (HEAD)"
                lines={section.ours}
                chosen={choices[i]}
                side="ours"
                onChoose={(c) => setChoices((prev) => prev.map((v, j) => (j === i ? c : v)))}
                bg="bg-green-950/30"
                activeBg="bg-green-900/40"
              />
              <SidePanel
                label="Entrant"
                lines={section.theirs}
                chosen={choices[i]}
                side="theirs"
                onChoose={(c) => setChoices((prev) => prev.map((v, j) => (j === i ? c : v)))}
                bg="bg-blue-950/30"
                activeBg="bg-blue-900/40"
              />
            </div>
            <div className="flex justify-center gap-2 p-1 bg-shade/20 border-t border-overlay/10">
              <ChoiceBtn active={choices[i] === "both"} onClick={() => setChoices((p) => p.map((v, j) => j === i ? "both" : v))}>
                Garder les deux
              </ChoiceBtn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidePanel({ label, lines, chosen, side, onChoose, bg, activeBg }: {
  label: string; lines: string[]; chosen: string; side: "ours" | "theirs";
  onChoose: (c: Resolution) => void; bg: string; activeBg: string;
}) {
  const active = chosen === side || chosen === "both";
  return (
    <div
      className={`${active ? activeBg : bg} cursor-pointer hover:opacity-90 transition-colors`}
      onClick={() => onChoose(side)}
    >
      <div className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 ${active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>
        {active && <span>✓</span>}
        {label}
      </div>
      <div className="px-2 py-1">
        {lines.map((l, i) => <div key={i} className={`whitespace-pre ${active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>{l || " "}</div>)}
      </div>
    </div>
  );
}

function ChoiceBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[9px] px-2 py-0.5 rounded transition-colors ${active ? "bg-overlay/20 text-[var(--color-text)]" : "text-[var(--color-muted)] hover:bg-overlay/10"}`}
    >
      {children}
    </button>
  );
}
