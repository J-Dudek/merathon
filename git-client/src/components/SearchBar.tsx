import { Search, X } from "lucide-react";
import { useRepoStore } from "../store/useRepoStore";
import { fieldLabel } from "../lib/fieldLabel";
import { filterCommits } from "../search/filterCommits";
import { plural } from "../lib/strings";

export function SearchBar() {
  const query = useRepoStore((s) => s.searchQuery);
  const setQuery = useRepoStore((s) => s.setSearchQuery);
  const commits = useRepoStore((s) => s.commits);

  if (commits.length === 0) return null;
  const found = filterCommits(commits, query).length;
  const foundLabel = query.trim() ? resultsLabel(found) : "";

  return (
    <div className="relative flex items-center">
      <Search size={12} className="absolute left-2 text-[var(--color-muted)] pointer-events-none" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher commit, auteur, hash…"
        {...fieldLabel("Rechercher un commit (message, auteur, hash)")}
        className="bg-shade/30 border border-overlay/50 rounded pl-6 pr-8 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/50 placeholder:text-[var(--color-muted)] w-64 max-[760px]:w-48"
      />
      {query && (
        <button
          className="absolute right-1 flex h-6 w-6 items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs"
          onClick={() => setQuery("")}
          aria-label="Effacer la recherche"
        >
          <X size={12} />
        </button>
      )}
      {/* Nombre de résultats, annoncé pendant la saisie (RGAA 7.5). */}
      <span role="status" className="sr-only">
        {foundLabel}
      </span>
    </div>
  );
}

/** « 3 commits trouvés », « 1 commit trouvé ». */
function resultsLabel(n: number): string {
  return n > 1 ? `${plural(n, "commit")} trouvés` : `${plural(n, "commit")} trouvé`;
}
