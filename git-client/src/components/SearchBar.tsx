import { useState } from "react";
import { Search, X } from "lucide-react";
import { useRepoStore } from "../store/useRepoStore";
import { fieldLabel } from "../lib/fieldLabel";
import { filterCommits } from "../search/filterCommits";
import { isMobile } from "../lib/platform";
import { tr, trn } from "../i18n";

export function SearchBar() {
  const query = useRepoStore((s) => s.searchQuery);
  const setQuery = useRepoStore((s) => s.setSearchQuery);
  const commits = useRepoStore((s) => s.commits);
  const mobile = isMobile();
  // Mobile : une loupe seule tant que la recherche n'est pas ouverte, pour ne pas prendre une ligne de la barre d'outils.
  const [open, setOpen] = useState(false);

  if (commits.length === 0) return null;
  if (mobile && !open && !query) {
    return (
      <button
        className="p-2 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
        onClick={() => setOpen(true)}
        aria-label={tr("Rechercher un commit (message, auteur, hash)")}
      >
        <Search size={16} strokeWidth={1.75} />
      </button>
    );
  }
  const found = filterCommits(commits, query).length;
  const foundLabel = query.trim() ? resultsLabel(found) : "";

  return (
    <div className="relative flex items-center">
      <Search size={12} className="absolute left-2 text-[var(--color-muted)] pointer-events-none" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr("Rechercher commit, auteur, hash…")}
        {...fieldLabel(tr("Rechercher un commit (message, auteur, hash)"))}
        autoFocus={mobile}
        className={`bg-shade/30 border border-overlay/50 rounded pl-6 pr-8 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/50 placeholder:text-[var(--color-muted)] w-64 max-[760px]:w-48 ${mobile ? "w-[min(16rem,calc(100vw-3rem))]!" : ""}`}
      />
      {query && (
        <button
          className="absolute right-1 flex h-6 w-6 items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs"
          onClick={() => {
            setQuery("");
            setOpen(false);
          }}
          aria-label={tr("Effacer la recherche")}
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
  return trn(n, "{n} commit trouvé", "{n} commits trouvés");
}
