import { create } from "zustand";
import {
  emptyMilestones, isMilestone, nextMilestone, random, recordEvent, sanitizeMilestones, type Celebration, type MilestoneKind, type MilestoneState,
} from "../lib/milestones";

/** Compteurs partagés entre les fenêtres (relus à chaque action, une autre fenêtre a pu compter entre-temps). */
const KEY = "merathon.milestones";

function load(): MilestoneState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeMilestones(JSON.parse(raw)) : emptyMilestones();
  } catch {
    return emptyMilestones();
  }
}

function save(state: MilestoneState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // stockage indisponible : on ne compte pas
  }
}

interface CelebrationStore {
  /** Animation en cours ; `id` relance l'animation même si la précédente n'est pas finie. */
  current: (Celebration & { id: number }) | null;
  /** Compteurs et récompenses obtenues, pour « Mon activité ». */
  milestones: MilestoneState;
  /** Compte une action réussie et lance l'animation d'un palier atteint. */
  track: (kind: MilestoneKind) => void;
  /** Mode dev : un palier ou une surprise au hasard, sans toucher aux vrais compteurs. */
  preview: () => void;
  dismiss: () => void;
  /** « Mon activité » consultée : les récompenses obtenues jusqu'ici ne sont plus nouvelles. */
  markSeen: () => void;
}

let nextId = 1;

export const useCelebrationStore = create<CelebrationStore>((set) => ({
  current: null,
  milestones: load(),

  track: (kind) => {
    const { state, celebration } = recordEvent(load(), kind);
    save(state);
    set({ milestones: state });
    if (celebration) set({ current: { ...celebration, id: nextId++ } });
  },

  preview: () => {
    const kinds: MilestoneKind[] = ["commit", "branch", "pr", "merge"];
    const surprise = random() < 0.25;
    const kind = surprise ? "commit" : kinds[Math.floor(random() * kinds.length)];
    // Un compte juste avant un palier ; pour la surprise, juste avant un commit hors palier, avec un premier tirage gagnant.
    let count = surprise ? Math.floor(random() * 200) + 1 : nextMilestone(kind, Math.floor(random() * 300));
    while (surprise && isMilestone(kind, count)) count++;
    const fake = load();
    fake.counts = { ...fake.counts, [kind]: count - 1 };
    let first = surprise;
    const rand = () => (first ? ((first = false), 0) : random());
    const { celebration } = recordEvent(fake, kind, rand);
    if (celebration) set({ current: { ...celebration, id: nextId++ } });
  },

  dismiss: () => set({ current: null }),

  markSeen: () => {
    const state = { ...load(), seenAt: Date.now() };
    save(state);
    set({ milestones: state });
  },
}));

/** Récompenses obtenues depuis la dernière visite de « Mon activité ». */
export const hasNewRewards = (m: MilestoneState) => m.rewards.some((r) => r.at !== null && r.at > m.seenAt);

// Une autre fenêtre a compté ou consulté « Mon activité » : on reprend son état.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useCelebrationStore.setState({ milestones: load() });
  });
}
