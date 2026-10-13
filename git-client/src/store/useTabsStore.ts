import { create } from "zustand";
import { emptyRepo, useRepoStore, type RepoState } from "./useRepoStore";
import { useUiStore } from "./useUiStore";
import { errorMessage } from "../lib/actions";
import { trimEndChars } from "../lib/strings";

/**
 * Onglets de dépôts d'une fenêtre.
 *
 * `useRepoStore` contient toujours le dépôt de l'onglet actif : toutes les actions (pull, push…)
 * s'appliquent donc à lui. En changeant d'onglet, son état est mis de côté puis celui de l'onglet
 * cible est réaffiché (et rafraîchi).
 */
export interface RepoTab {
  id: number;
  /** Dépôt de l'onglet quand il n'est pas actif ; pour l'onglet actif, voir `useRepoStore.repoPath`. */
  path: string | null;
}

interface TabsStore {
  tabs: RepoTab[];
  activeId: number;

  newTab: () => void;
  switchTab: (id: number) => Promise<void>;
  /** Ferme un onglet ; le dernier onglet est seulement vidé. */
  closeTab: (id: number) => void;
  /** Ouvre un dépôt : bascule sur son onglet s'il est déjà ouvert, sinon l'ouvre dans l'onglet vide courant ou un nouvel onglet. */
  openInTab: (path: string) => Promise<void>;
  /** Recrée les onglets d'une session précédente ; seul l'onglet actif est chargé tout de suite. */
  restoreSession: (paths: string[], active: number) => Promise<void>;
}

/** États mis de côté des onglets inactifs. Absent : onglet pas encore chargé (session restaurée). */
const snapshots = new Map<number, RepoState>();
let nextId = 2;

/** Dépôt affiché par un onglet, qu'il soit actif ou non. */
export function tabPath(tab: RepoTab, activeId: number): string | null {
  return tab.id === activeId ? useRepoStore.getState().repoPath : tab.path;
}

function samePath(a: string | null, b: string | null): boolean {
  return !!a && !!b && trimEndChars(a, "\\/") === trimEndChars(b, "\\/");
}

/** Charge un dépôt dans l'onglet actif ; renvoie faux (erreur notifiée) s'il n'a pas pu être ouvert. */
async function loadRepo(path: string): Promise<boolean> {
  try {
    await useRepoStore.getState().openRepo(path);
    return true;
  } catch (e) {
    useUiStore.getState().notify("error", `Impossible d'ouvrir ${path} : ${errorMessage(e)}`);
    return false;
  }
}

export const useTabsStore = create<TabsStore>((set, get) => {
  /** Met de côté l'onglet actif et renvoie la liste des onglets avec son chemin à jour. */
  function stashActive(): RepoTab[] {
    const { tabs, activeId } = get();
    const state = useRepoStore.getState().snapshot();
    snapshots.set(activeId, state);
    return tabs.map((t) => (t.id === activeId ? { ...t, path: state.repoPath } : t));
  }

  function removeTab(id: number) {
    snapshots.delete(id);
    set((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }));
  }

  return {
    tabs: [{ id: 1, path: null }],
    activeId: 1,

    newTab: () => {
      const tabs = stashActive();
      const id = nextId++;
      useUiStore.getState().setInteractiveRebaseBase(null);
      useRepoStore.getState().restore(emptyRepo);
      set({ tabs: [...tabs, { id, path: null }], activeId: id });
    },

    switchTab: async (id) => {
      const target = get().tabs.find((t) => t.id === id);
      if (!target || id === get().activeId) return;
      const tabs = stashActive();
      const saved = snapshots.get(id);
      snapshots.delete(id);
      useUiStore.getState().setInteractiveRebaseBase(null);
      const repo = useRepoStore.getState();
      repo.restore(saved ?? emptyRepo);
      set({ tabs, activeId: id });
      if (saved?.repoPath) {
        // Le dépôt a pu changer pendant que l'onglet était en arrière-plan.
        await repo.refresh().catch((e) => useUiStore.getState().notify("error", errorMessage(e)));
      } else if (!saved && target.path) {
        await loadRepo(target.path);
      }
    },

    closeTab: (id) => {
      const { tabs, activeId } = get();
      const index = tabs.findIndex((t) => t.id === id);
      if (index < 0) return;
      if (tabs.length === 1) {
        useUiStore.getState().setInteractiveRebaseBase(null);
        useRepoStore.getState().closeRepo();
        return;
      }
      if (id === activeId) void get().switchTab((tabs[index + 1] ?? tabs[index - 1]).id);
      removeTab(id);
    },

    openInTab: async (path) => {
      const { tabs, activeId } = get();
      const existing = tabs.find((t) => samePath(tabPath(t, activeId), path));
      if (existing) {
        await get().switchTab(existing.id);
        return;
      }
      const created = useRepoStore.getState().repoPath !== null;
      if (created) get().newTab();
      const opened = await loadRepo(path);
      // Échec dans un onglet créé pour l'occasion : on revient où l'on était.
      if (!opened && created && !useRepoStore.getState().repoPath) {
        const failed = get().activeId;
        await get().switchTab(activeId);
        removeTab(failed);
      }
    },

    restoreSession: async (paths, active) => {
      if (paths.length === 0) return;
      const tabs = paths.map((path) => ({ id: nextId++, path }));
      const current = tabs[Math.min(Math.max(active, 0), tabs.length - 1)];
      snapshots.clear();
      useRepoStore.getState().restore(emptyRepo);
      set({ tabs, activeId: current.id });
      await loadRepo(current.path);
    },
  };
});

const SESSION_KEY = "git-client.open-tabs";

interface Session {
  paths: string[];
  active: number;
}

/** Dépôts ouverts dans les onglets (onglets vides ignorés) et position de l'onglet actif parmi eux. */
export function currentSession(): Session {
  const { tabs, activeId } = useTabsStore.getState();
  const open = tabs.map((t) => ({ id: t.id, path: tabPath(t, activeId) })).filter((t) => t.path);
  return { paths: open.map((t) => t.path!), active: Math.max(0, open.findIndex((t) => t.id === activeId)) };
}

let sessionRestored = false;

/** Rouvre les onglets de la dernière session puis les enregistre à chaque changement (fenêtre principale uniquement). */
export function persistTabSession(restore: boolean) {
  // Une seule restauration, même si l'effet appelant est rejoué (StrictMode).
  if (restore && !sessionRestored) {
    sessionRestored = true;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const saved = raw ? (JSON.parse(raw) as Session) : null;
      if (saved && Array.isArray(saved.paths)) void useTabsStore.getState().restoreSession(saved.paths, saved.active);
    } catch {
      // session illisible : on démarre sur un onglet vide
    }
  }
  let last = "";
  const save = () => {
    const raw = JSON.stringify(currentSession());
    if (raw === last) return;
    last = raw;
    try {
      localStorage.setItem(SESSION_KEY, raw);
    } catch {
      // stockage indisponible : la session ne sera pas restaurée
    }
  };
  const unsubTabs = useTabsStore.subscribe(save);
  const unsubRepo = useRepoStore.subscribe((s, prev) => {
    if (s.repoPath !== prev.repoPath) save();
  });
  return () => {
    unsubTabs();
    unsubRepo();
  };
}
