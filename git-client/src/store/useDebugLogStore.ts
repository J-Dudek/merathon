import { create } from "zustand";
import { useDisplayStore } from "./useDisplayStore";

export type DebugLevel = "debug" | "info" | "warn" | "error";

export interface DebugLogEntry {
  id: number;
  time: number;
  level: DebugLevel;
  message: string;
}

const MAX_ENTRIES = 2000;

/** Retire l'identifiant ou le token des URL (https://user:token@host/…), où qu'elles soient dans le message. */
export function redactSecrets(message: string): string {
  return message.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1");
}

interface DebugLogStore {
  entries: DebugLogEntry[];
  add: (level: DebugLevel, message: string) => void;
  clear: () => void;
}

let nextId = 1;

/** Logs du mode débug : en mémoire uniquement, rien n'est écrit sur le disque. */
export const useDebugLogStore = create<DebugLogStore>((set) => ({
  entries: [],

  add: (level, message) => {
    if (!useDisplayStore.getState().debugMode) return;
    const entry = { id: nextId++, time: Date.now(), level, message: redactSecrets(message) };
    set((s) => ({ entries: [...s.entries, entry].slice(-MAX_ENTRIES) }));
  },

  clear: () => set({ entries: [] }),
}));

/** Raccourci pour journaliser une opération (voir `ipc/commands.ts`). */
export const debugLog = (level: DebugLevel, message: string) => useDebugLogStore.getState().add(level, message);
