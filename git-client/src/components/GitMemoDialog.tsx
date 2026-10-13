import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Modal, inputClass } from "./Modal";
import { filterMemo, GIT_MEMO, type MemoEntry } from "../lib/gitMemo";

/** Mémo des opérations git : à quoi elles servent, un cas d'usage, et comment les faire dans l'application. */
export function GitMemoDialog({ onClose }: { onClose: () => void }) {
  const [groupId, setGroupId] = useState(GIT_MEMO[0].id);
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  // Une recherche porte sur tout le mémo, sinon seule la rubrique choisie est affichée.
  const groups = searching ? filterMemo(GIT_MEMO, query) : GIT_MEMO.filter((g) => g.id === groupId);

  return (
    <Modal title="Mémo Git" onClose={onClose} width="w-[860px]" height="h-[76vh]" resizeKey="git-memo">
      <div className="flex h-full text-xs text-[var(--color-text)]">
        <nav className="w-48 shrink-0 p-2 border-r border-overlay/10 bg-shade/10 flex flex-col gap-0.5 overflow-y-auto">
          <input
            className={`${inputClass} mb-1.5`}
            placeholder="Rechercher…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {GIT_MEMO.map(({ id, label, entries }) => {
            const active = !searching && id === groupId;
            return (
              <button
                key={id}
                onClick={() => {
                  setGroupId(id);
                  setQuery("");
                }}
                className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                  active
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-text)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/5"
                }`}
              >
                {label}
                <span className="text-[10px] opacity-60">{entries.length}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
          {groups.length === 0 && <p className="text-[var(--color-muted)] italic">Aucune opération ne correspond à « {query.trim()} ».</p>}
          {groups.map((group) => (
            <section key={group.id} className="mb-6 last:mb-0">
              <h2 className="mb-3 text-base font-semibold">{group.label}</h2>
              <div className="flex flex-col gap-3">
                {group.entries.map((entry) => <MemoCard key={entry.title} entry={entry} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function MemoCard({ entry }: { entry: MemoEntry }) {
  return (
    <article className="rounded-lg border border-overlay/10 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{entry.title}</h3>
        <code className="font-mono text-[11px] text-[var(--color-accent)] select-text">{entry.command}</code>
      </div>
      <p className="mt-1.5 leading-relaxed">{entry.summary}</p>

      <MemoLabel>Cas d'usage</MemoLabel>
      <p className="leading-relaxed text-[var(--color-muted)]">{entry.example}</p>

      <MemoLabel>Dans Merathon</MemoLabel>
      <ol className="list-decimal pl-4 space-y-0.5 leading-relaxed">
        {entry.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>

      {entry.warning && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 leading-relaxed text-amber-300">
          <TriangleAlert size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          {entry.warning}
        </p>
      )}
    </article>
  );
}

function MemoLabel({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">{children}</p>;
}
