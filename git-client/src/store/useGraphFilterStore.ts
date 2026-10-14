import { create } from "zustand";
import { EMPTY_FILTER, type GraphFilter } from "../lib/graphFilter";

/** Branches masquées ou en solo dans le graphe, par dépôt ; mémorisé et commun à toutes les fenêtres. */
const KEY = "merathon.graph-filters";

function load(): Record<string, GraphFilter> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, GraphFilter>;
  } catch {
    return {};
  }
}

const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

interface GraphFilterStore {
  filters: Record<string, GraphFilter>;
  toggleHidden: (repo: string, key: string) => void;
  toggleSolo: (repo: string, key: string) => void;
  /** Réaffiche toutes les branches du dépôt. */
  clear: (repo: string) => void;
}

export const useGraphFilterStore = create<GraphFilterStore>((set, get) => {
  function save(repo: string, filter: GraphFilter) {
    const filters = { ...get().filters };
    if (filter.hidden.length || filter.solo.length) filters[repo] = filter;
    else delete filters[repo];
    set({ filters });
    try {
      localStorage.setItem(KEY, JSON.stringify(filters));
    } catch {
      // stockage indisponible : filtre gardé pour la session
    }
  }
  const current = (repo: string) => get().filters[repo] ?? EMPTY_FILTER;
  return {
    filters: load(),
    toggleHidden: (repo, key) => save(repo, { ...current(repo), hidden: toggle(current(repo).hidden, key) }),
    toggleSolo: (repo, key) => save(repo, { ...current(repo), solo: toggle(current(repo).solo, key) }),
    clear: (repo) => save(repo, EMPTY_FILTER),
  };
});

// Une autre fenêtre a changé un filtre : on le reprend.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useGraphFilterStore.setState({ filters: load() });
  });
}
