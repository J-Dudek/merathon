import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { useTabsStore } from "../store/useTabsStore";
import { useUiStore, type BottomPanelState } from "../store/useUiStore";
import { useJournalStore, type JournalEntry } from "../store/useJournalStore";
import { errorMessage } from "../lib/actions";
import { attachTerminal, restartTerminal } from "../lib/terminals";

const HEADER_HEIGHT = 28;
const MIN_HEIGHT = 120;

/** Panneau repliable sous le graphe : terminal du dépôt et journal des opérations. */
export function BottomPanel() {
  const panel = useUiStore((s) => s.panel);
  const setPanel = useUiStore((s) => s.setPanel);
  const repoPath = useRepoStore((s) => s.repoPath);
  const tabId = useTabsStore((s) => s.activeId);
  const errorCount = useJournalStore((s) => s.entries.filter((e) => e.repo === repoPath && e.status === "error").length);
  const [seenErrors, setSeenErrors] = useState(errorCount);
  const [onlyRepo, setOnlyRepo] = useState(true);
  const clear = useJournalStore((s) => s.clear);

  const journalVisible = panel.open && panel.tab === "journal";
  useEffect(() => {
    if (journalVisible) setSeenErrors(errorCount);
  }, [journalVisible, errorCount]);
  const newErrors = Math.max(0, errorCount - seenErrors);

  function select(tab: BottomPanelState["tab"]) {
    setPanel(panel.open && panel.tab === tab ? { open: false } : { open: true, tab });
  }

  // Redimensionnement en tirant la bordure haute.
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const max = (e.currentTarget.closest("main")?.clientHeight ?? window.innerHeight) * 0.8;
    const startY = e.clientY;
    const startHeight = panel.height;
    const move = (ev: PointerEvent) => {
      const height = Math.round(Math.min(max, Math.max(MIN_HEIGHT, startHeight + startY - ev.clientY)));
      setPanel({ height });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!repoPath) return null;

  return (
    <div
      className="flex flex-col shrink-0 border-t border-overlay/10 bg-[var(--color-bg-secondary)]"
      style={{ height: panel.open ? panel.height : HEADER_HEIGHT }}
    >
      <div className="flex items-center shrink-0 relative" style={{ height: HEADER_HEIGHT }}>
        {panel.open && (
          <div
            className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-10"
            onPointerDown={startResize}
            title="Redimensionner"
          />
        )}
        <PanelTab active={panel.open && panel.tab === "terminal"} onClick={() => select("terminal")}>Terminal</PanelTab>
        <PanelTab active={journalVisible} onClick={() => select("journal")}>
          Journal
          {newErrors > 0 && <span className="ml-1.5 text-[9px] px-1 rounded-full bg-red-500/80 text-white leading-4">{newErrors}</span>}
        </PanelTab>

        <div className="ml-auto flex items-center gap-1 pr-2">
          {panel.open && panel.tab === "terminal" && (
            <HeaderBtn onClick={() => restartTerminal(tabId)} title="Relancer le shell">↻</HeaderBtn>
          )}
          {journalVisible && (
            <>
              <label className="flex items-center gap-1 text-[10px] text-[var(--color-muted)] mr-2 cursor-pointer">
                <input type="checkbox" checked={onlyRepo} onChange={(e) => setOnlyRepo(e.target.checked)} />
                Ce dépôt seulement
              </label>
              <HeaderBtn onClick={clear} title="Effacer le journal">⌫</HeaderBtn>
            </>
          )}
          <HeaderBtn
            onClick={() => setPanel({ open: !panel.open })}
            title={panel.open ? "Replier (Ctrl+J)" : "Déplier (Ctrl+J)"}
          >
            {panel.open ? "▾" : "▴"}
          </HeaderBtn>
        </div>
      </div>

      {panel.open && (
        <div className="flex-1 min-h-0 bg-[var(--color-bg-primary)]">
          {panel.tab === "terminal" ? (
            <TerminalView key={`${tabId}:${repoPath}`} tabId={tabId} path={repoPath} />
          ) : (
            <JournalView repo={onlyRepo ? repoPath : null} />
          )}
        </div>
      )}
    </div>
  );
}

function TerminalView({ tabId, path }: { tabId: number; path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    try {
      return attachTerminal(tabId, path, ref.current);
    } catch (e) {
      console.error("Terminal :", e);
      setError(errorMessage(e));
    }
  }, [tabId, path]);
  if (error) return <p className="p-3 text-xs text-red-400 font-mono whitespace-pre-wrap">Terminal indisponible : {error}</p>;
  return <div ref={ref} className="h-full w-full pl-2 pt-1" />;
}

const STATUS: Record<JournalEntry["status"], { icon: string; color: string }> = {
  running: { icon: "…", color: "text-[var(--color-muted)] animate-pulse" },
  success: { icon: "✓", color: "text-green-400" },
  warning: { icon: "!", color: "text-yellow-400" },
  error: { icon: "✗", color: "text-red-400" },
};

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function JournalView({ repo }: { repo: string | null }) {
  const all = useJournalStore((s) => s.entries);
  const entries = repo ? all.filter((e) => e.repo === repo) : all;
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Reste collé en bas tant que l'utilisateur n'est pas remonté dans l'historique.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, all]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      }}
      className="h-full overflow-auto px-3 py-1 font-mono text-[11px] leading-5 select-text"
    >
      {entries.length === 0 ? (
        <p className="text-[var(--color-muted)] italic font-sans text-xs py-2">
          Aucune opération pour l'instant. Les actions faites dans l'application (commit, pull, push…) s'affichent
          ici sous forme de commande git équivalente.
        </p>
      ) : (
        entries.map((e) => {
          const status = STATUS[e.status];
          return (
            <div key={e.id}>
              <div className="flex gap-2 whitespace-nowrap">
                <span className="text-[var(--color-muted)] shrink-0">{formatTime(e.time)}</span>
                {!repo && e.repo && (
                  <span className="text-[var(--color-muted)] shrink-0" title={e.repo}>
                    [{e.repo.split(/[\\/]/).pop()}]
                  </span>
                )}
                <span className={`shrink-0 w-3 text-center ${status.color}`}>{status.icon}</span>
                <span className="text-[var(--color-text)] truncate" title={e.command}>
                  <span className="text-[var(--color-accent)]">$ </span>
                  {e.command}
                </span>
                {e.durationMs !== undefined && (
                  <span className="text-[var(--color-muted)] ml-auto shrink-0">{formatDuration(e.durationMs)}</span>
                )}
              </div>
              {e.detail && (
                <pre className={`whitespace-pre-wrap pl-[7.5rem] ${e.status === "error" ? "text-red-400" : "text-yellow-400"}`}>
                  {e.detail}
                </pre>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function PanelTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center h-full px-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
        active
          ? "text-[var(--color-text)] border-[var(--color-accent)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-text)] border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function HeaderBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-6 h-6 rounded text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
    >
      {children}
    </button>
  );
}
