import { Plus, X } from "lucide-react";
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
      <nav aria-label="Dépôts ouverts" className="flex items-stretch min-w-0">
        {tabs.map((tab) => {
          const path = pathOf(tab);
          const active = tab.id === activeId;
          const name = path?.split(/[\\/]/).pop() || "Nouvel onglet";
          return (
            <div
              key={tab.id}
              title={path ?? undefined}
              onClick={() => switchTab(tab.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
              className={`group flex items-center gap-2 pl-3 pr-1 min-w-0 max-w-52 cursor-pointer border-r border-overlay/10 border-b-2 text-xs ${
                active
                  ? "bg-[var(--color-bg-primary)] text-[var(--color-text)] border-b-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/5 border-b-transparent"
              }`}
            >
              {/* Vrai bouton : l'onglet s'active aussi au clavier (le clic remonte au conteneur). */}
              <button type="button" aria-current={active ? "page" : undefined} className="truncate text-left">
                {name}
              </button>
              <button
                className={`shrink-0 w-4 h-4 leading-4 rounded text-[11px] hover:bg-overlay/15 ${active ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Fermer l'onglet ${name}`}
                title="Fermer l'onglet (Ctrl+W)"
              >
                <X size={12} className="mx-auto" />
              </button>
            </div>
          );
        })}
      </nav>
      <button
        className="px-3 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/5"
        onClick={newTab}
        title="Nouvel onglet (Ctrl+T)"
        aria-label="Nouvel onglet"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
