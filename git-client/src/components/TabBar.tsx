import { useRepoStore } from "../store/useRepoStore";
import { useTabsStore, type RepoTab } from "../store/useTabsStore";

/** Onglets des dépôts ouverts dans la fenêtre. */
export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const switchTab = useTabsStore((s) => s.switchTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const newTab = useTabsStore((s) => s.newTab);
  const activePath = useRepoStore((s) => s.repoPath);

  const pathOf = (tab: RepoTab) => (tab.id === activeId ? activePath : tab.path);

  return (
    <div className="flex items-stretch h-8 shrink-0 bg-[var(--color-bg-secondary)] border-b border-overlay/10 overflow-x-auto">
      {tabs.map((tab) => {
        const path = pathOf(tab);
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={path ?? undefined}
            onClick={() => switchTab(tab.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
            className={`group flex items-center gap-2 pl-3 pr-1 min-w-0 max-w-52 cursor-pointer border-r border-overlay/10 border-b-2 text-xs ${
              active
                ? "bg-[var(--color-bg-primary)] text-[var(--color-text)] border-b-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/5 border-b-transparent"
            }`}
          >
            <span className="truncate">{path?.split(/[\\/]/).pop() || "Nouvel onglet"}</span>
            <button
              className={`shrink-0 w-4 h-4 leading-4 rounded text-[11px] hover:bg-overlay/15 ${active ? "" : "opacity-0 group-hover:opacity-100"}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              aria-label="Fermer l'onglet"
              title="Fermer l'onglet (Ctrl+W)"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="px-3 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/5"
        onClick={newTab}
        title="Nouvel onglet (Ctrl+T)"
        aria-label="Nouvel onglet"
      >
        +
      </button>
    </div>
  );
}
