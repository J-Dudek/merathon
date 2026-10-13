import { useRepoStore } from "../store/useRepoStore";

export function SearchBar() {
  const query = useRepoStore((s) => s.searchQuery);
  const setQuery = useRepoStore((s) => s.setSearchQuery);
  const commits = useRepoStore((s) => s.commits);

  if (commits.length === 0) return null;

  return (
    <div className="relative flex items-center">
      <span className="absolute left-2 text-[var(--color-muted)] text-xs pointer-events-none">⌕</span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher commit, auteur, hash…"
        className="bg-shade/30 border border-overlay/10 rounded pl-6 pr-8 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/50 placeholder:text-[var(--color-muted)] w-64"
      />
      {query && (
        <button
          className="absolute right-2 text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs"
          onClick={() => setQuery("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}
