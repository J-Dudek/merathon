import { create } from "zustand";

export interface JournalEntry {
  id: number;
  /** Début de l'opération (ms depuis l'epoch). */
  time: number;
  /** Dépôt concerné, s'il y en a un. */
  repo: string | null;
  command: string;
  status: "running" | "success" | "warning" | "error";
  durationMs?: number;
  /** Message d'erreur ou d'avertissement (conflits…). */
  detail?: string;
}

const MAX_ENTRIES = 500;

interface JournalStore {
  entries: JournalEntry[];
  start: (repo: string | null, command: string) => number;
  finish: (id: number, status: Exclude<JournalEntry["status"], "running">, detail?: string) => void;
  clear: () => void;
}

let nextId = 1;

export const useJournalStore = create<JournalStore>((set) => ({
  entries: [],

  start: (repo, command) => {
    const id = nextId++;
    const entry: JournalEntry = { id, time: Date.now(), repo, command, status: "running" };
    set((s) => ({ entries: [...s.entries, entry].slice(-MAX_ENTRIES) }));
    return id;
  },

  finish: (id, status, detail) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, status, detail, durationMs: Date.now() - e.time } : e)),
    })),

  clear: () => set((s) => ({ entries: s.entries.filter((e) => e.status === "running") })),
}));
