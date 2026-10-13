import { create } from "zustand";
import type {
  BranchInfo, CommitInfo, FileStatus, LfsStatus, RemoteInfo, RepoInfo, StashInfo, SubmoduleInfo, TagInfo,
} from "../types/git";
import {
  getBranches, getCommits, getRepoInfo, getStatus, getTags, lfsStatus, listRemotes, listStashes, listSubmodules, openRepository,
} from "../ipc/commands";

/** Ce qu'affiche la zone centrale : le graphe, un diff ou l'éditeur de conflit. */
export type CenterView =
  | { kind: "graph" }
  | { kind: "diff"; path: string; source: { type: "workdir"; staged: boolean } | { type: "commit"; hash: string } }
  | { kind: "conflict"; path: string };

const RECENT_KEY = "git-client.recent-repos";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // stockage indisponible : la liste reste en mémoire
  }
}

/** Message de commit en cours de rédaction (conservé par onglet). */
export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

interface RepoStore {
  repoPath: string | null;
  info: RepoInfo | null;
  commits: CommitInfo[];
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  remotes: RemoteInfo[];
  submodules: SubmoduleInfo[];
  lfs: LfsStatus | null;
  status: FileStatus[];
  selectedCommit: CommitInfo | null;
  searchQuery: string;
  center: CenterView;
  commitDraft: CommitDraft;
  recentRepos: string[];

  openRepo: (path: string) => Promise<void>;
  closeRepo: () => void;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setSelectedCommit: (commit: CommitInfo | null) => void;
  setSearchQuery: (q: string) => void;
  setCenter: (view: CenterView) => void;
  setCommitDraft: (patch: Partial<CommitDraft>) => void;
  forgetRecent: (path: string) => void;
  /** État du dépôt affiché, pour le mettre de côté en changeant d'onglet. */
  snapshot: () => RepoState;
  /** Réaffiche un état mis de côté par `snapshot`. */
  restore: (state: RepoState) => void;
}

/** Tout l'état propre au dépôt ouvert (sans la liste des récents, commune à tous les onglets). */
export type RepoState = Omit<RepoStore, "recentRepos" | {
  [K in keyof RepoStore]: RepoStore[K] extends (...args: never[]) => unknown ? K : never;
}[keyof RepoStore]>;

/** Incrémenté à chaque changement de dépôt affiché : une ouverture en cours devenue obsolète est abandonnée. */
let generation = 0;

export const emptyRepo: RepoState = {
  repoPath: null,
  info: null,
  commits: [],
  branches: [],
  tags: [],
  stashes: [],
  remotes: [],
  submodules: [],
  lfs: null,
  status: [],
  selectedCommit: null,
  searchQuery: "",
  center: { kind: "graph" },
  commitDraft: { summary: "", description: "", amend: false },
};

export const useRepoStore = create<RepoStore>((set, get) => ({
  ...emptyRepo,
  recentRepos: loadRecent(),

  openRepo: async (path) => {
    const gen = ++generation;
    const info = await openRepository(path);
    if (gen !== generation) return; // l'utilisateur a changé d'onglet entre-temps
    const recentRepos = [info.path, ...get().recentRepos.filter((p) => p !== info.path)].slice(0, MAX_RECENT);
    saveRecent(recentRepos);
    set({ ...emptyRepo, repoPath: info.path, info, recentRepos });
    await get().refresh();
  },

  closeRepo: () => {
    generation++;
    set(emptyRepo);
  },

  refresh: async () => {
    const path = get().repoPath;
    if (!path) return;
    const [info, commits, branches, tags, stashes, remotes, submodules, lfs, status] = await Promise.all([
      getRepoInfo(path),
      getCommits(path),
      getBranches(path),
      getTags(path),
      listStashes(path),
      listRemotes(path),
      listSubmodules(path),
      lfsStatus(path).catch(() => null),
      getStatus(path),
    ]);
    if (get().repoPath !== path) return; // un autre dépôt a été ouvert entre-temps
    const selected = get().selectedCommit;
    set({
      info, commits, branches, tags, stashes, remotes, submodules, lfs, status,
      selectedCommit: selected ? commits.find((c) => c.hash === selected.hash) ?? null : null,
    });
  },

  refreshStatus: async () => {
    const path = get().repoPath;
    if (!path) return;
    const [info, status] = await Promise.all([getRepoInfo(path), getStatus(path)]);
    if (get().repoPath === path) set({ info, status });
  },

  setSelectedCommit: (selectedCommit) => set({ selectedCommit }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCenter: (center) => set({ center }),
  setCommitDraft: (patch) => set((s) => ({ commitDraft: { ...s.commitDraft, ...patch } })),

  forgetRecent: (path) => {
    const recentRepos = get().recentRepos.filter((p) => p !== path);
    saveRecent(recentRepos);
    set({ recentRepos });
  },

  snapshot: () => {
    const s = get();
    return {
      repoPath: s.repoPath, info: s.info, commits: s.commits, branches: s.branches, tags: s.tags, stashes: s.stashes,
      remotes: s.remotes, submodules: s.submodules, lfs: s.lfs, status: s.status, selectedCommit: s.selectedCommit,
      searchQuery: s.searchQuery, center: s.center, commitDraft: s.commitDraft,
    };
  },

  restore: (state) => {
    generation++;
    set(state);
  },
}));
