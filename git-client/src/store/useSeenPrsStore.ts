import { create } from "zustand";
import type { ForgePR } from "../types/forge";

/**
 * PR / MR consultées : état de la PR la dernière fois qu'elle a été ouverte (ou marquée comme lue).
 * Mémorisé dans ce navigateur, commun à toutes les fenêtres.
 */
export interface SeenPr {
  head: string;
  updatedAt: string;
  comments?: number;
  /** Date de la consultation (ms) : les plus anciennes sont oubliées au-delà de `MAX_SEEN`. */
  at: number;
}

/** Non lue, lue et inchangée depuis, ou lue puis modifiée (nouveaux commits, commentaires ou autre activité). */
export type PrFreshness =
  | { kind: "unread" }
  | { kind: "read" }
  | { kind: "updated"; commits: boolean; comments: boolean };

const KEY = "git-client.seen-prs";
const MAX_SEEN = 1000;

/** Début des clés de toutes les PR d'un projet. */
export const seenPrefix = (accountId: string, projectPath: string) => `${accountId}|${projectPath}#`;
export const seenKey = (accountId: string, projectPath: string, number: number) => `${seenPrefix(accountId, projectPath)}${number}`;

/** Compare une PR à son état lors de la dernière consultation. */
export function prFreshness(seen: SeenPr | undefined, pr: ForgePR): PrFreshness {
  if (!seen) return { kind: "unread" };
  // Une liste en cache peut être plus ancienne que la consultation : seule une activité postérieure compte.
  if (pr.updatedAt <= seen.updatedAt) return { kind: "read" };
  return {
    kind: "updated",
    commits: !!pr.headSha && pr.headSha !== seen.head,
    comments: pr.commentCount !== undefined && seen.comments !== undefined && pr.commentCount > seen.comments,
  };
}

function load(): Record<string, SeenPr> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, SeenPr>) : {};
  } catch {
    return {};
  }
}

/** Garde les `MAX_SEEN` consultations les plus récentes. */
function prune(seen: Record<string, SeenPr>): Record<string, SeenPr> {
  const entries = Object.entries(seen);
  if (entries.length <= MAX_SEEN) return seen;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_SEEN));
}

interface SeenPrsStore {
  seen: Record<string, SeenPr>;
  markSeen: (key: string, pr: ForgePR) => void;
  markUnread: (key: string) => void;
  /** Oublie les PR d'un projet qui ne sont plus ouvertes (mergées, fermées ou supprimées). */
  forgetClosed: (accountId: string, projectPath: string, open: number[]) => void;
}

export const useSeenPrsStore = create<SeenPrsStore>((set, get) => {
  function save(seen: Record<string, SeenPr>) {
    set({ seen });
    try {
      localStorage.setItem(KEY, JSON.stringify(seen));
    } catch {
      // stockage indisponible : gardé pour la session
    }
  }
  return {
    seen: load(),

    markSeen: (key, pr) => {
      const old = get().seen[key];
      // Déjà vue dans un état plus récent (PR ouverte depuis le détail, liste pas encore actualisée).
      if (old && old.updatedAt > pr.updatedAt) return;
      if (old && old.updatedAt === pr.updatedAt && old.head === pr.headSha && old.comments === pr.commentCount) return;
      const entry: SeenPr = { head: pr.headSha, updatedAt: pr.updatedAt, comments: pr.commentCount, at: Date.now() };
      save(prune({ ...get().seen, [key]: entry }));
    },

    markUnread: (key) => {
      if (!get().seen[key]) return;
      const rest = { ...get().seen };
      delete rest[key];
      save(rest);
    },

    forgetClosed: (accountId, projectPath, open) => {
      const prefix = seenPrefix(accountId, projectPath);
      const keep = new Set(open.map((n) => seenKey(accountId, projectPath, n)));
      const closed = Object.keys(get().seen).filter((k) => k.startsWith(prefix) && !keep.has(k));
      if (!closed.length) return;
      const rest = { ...get().seen };
      for (const k of closed) delete rest[k];
      save(rest);
    },
  };
});

// Une autre fenêtre a consulté une PR : on reprend son état.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useSeenPrsStore.setState({ seen: load() });
  });
}
