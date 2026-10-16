import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "error" | "success" | "info";
  message: string;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** Affiche un champ texte ; sa valeur est renvoyée dans `value`. */
  input?: { placeholder?: string; initial?: string; multiline?: boolean; secret?: boolean };
  /** Affiche une case à cocher ; son état est renvoyé dans `checked`. */
  checkbox?: { label: string; initial?: boolean };
  confirmLabel?: string;
  danger?: boolean;
  /** Liste à rubriques sous le message (ex. notes de version), dans une zone défilante. */
  sections?: DialogSection[];
  /** Lien affiché sous le champ de saisie, ouvert dans le navigateur. */
  link?: { label: string; url: string };
}

export interface DialogSection {
  title: string;
  items: string[];
}

export interface DialogResult {
  value: string;
  checked: boolean;
}

/** Panneau repliable sous le graphe (terminal / journal). */
export interface BottomPanelState {
  open: boolean;
  tab: "terminal" | "journal";
  /** Hauteur en pixels quand il est déplié. */
  height: number;
}

const PANEL_KEY = "merathon.bottom-panel";
const defaultPanel: BottomPanelState = { open: false, tab: "terminal", height: 260 };

function loadPanel(): BottomPanelState {
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    return raw ? { ...defaultPanel, ...(JSON.parse(raw) as Partial<BottomPanelState>) } : defaultPanel;
  } catch {
    return defaultPanel;
  }
}

/** Largeur en pixels des panneaux latéraux : barre latérale à gauche, détail du commit / staging à droite. */
export interface SideWidths {
  left: number;
  right: number;
}

export type Side = keyof SideWidths;

/** Rubriques de la fenêtre des préférences. */
export type PreferencesSection = "appearance" | "terminal" | "sync" | "shortcuts" | "activity" | "accessibility" | "about";

const SIDES_KEY = "merathon.side-widths";
export const defaultSideWidths: SideWidths = { left: 240, right: 320 };
export const SIDE_LIMITS: Record<Side, { min: number; max: number }> = {
  left: { min: 180, max: 600 },
  right: { min: 240, max: 800 },
};

/** Largeur bornée aux limites du panneau ; une valeur invalide redonne la largeur par défaut. */
export function clampSideWidth(side: Side, width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return defaultSideWidths[side];
  const { min, max } = SIDE_LIMITS[side];
  return Math.round(Math.min(max, Math.max(min, width)));
}

function loadSideWidths(): SideWidths {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDES_KEY) ?? "{}") as Partial<SideWidths> | null;
    return { left: clampSideWidth("left", raw?.left), right: clampSideWidth("right", raw?.right) };
  } catch {
    return defaultSideWidths;
  }
}

const GRAPH_KEY = "merathon.graph-width";
/** Largeur minimale de la colonne de l'arbre des branches : une voie. */
export const MIN_GRAPH_WIDTH = 48;

/** Largeur maximale de l'arbre choisie par l'utilisateur ; null (ou valeur invalide) : largeur de toutes les voies. */
export function clampGraphWidth(width: unknown): number | null {
  if (typeof width !== "number" || !Number.isFinite(width)) return null;
  return Math.round(Math.max(MIN_GRAPH_WIDTH, width));
}

function loadGraphWidth(): number | null {
  try {
    return clampGraphWidth(JSON.parse(localStorage.getItem(GRAPH_KEY) ?? "null"));
  } catch {
    return null;
  }
}

interface PendingDialog extends DialogOptions {
  resolve: (result: DialogResult | null) => void;
}

interface UiStore {
  toasts: Toast[];
  dialog: PendingDialog | null;
  /** Libellé de l'opération longue en cours (fetch, push…), null si aucune. */
  busy: string | null;
  /** Commit de base du rebase interactif en cours de préparation. */
  interactiveRebaseBase: string | null;
  panel: BottomPanelState;
  sideWidths: SideWidths;
  /** Largeur maximale de l'arbre des branches dans le graphe ; au-delà, les voies sont coupées. null : pas de limite. */
  graphWidth: number | null;
  /** Fenêtre des préférences ouverte. */
  preferencesOpen: boolean;
  /** Rubrique affichée à l'ouverture des préférences. */
  preferencesSection: PreferencesSection;
  /** Fenêtre du mémo git ouverte. */
  memoOpen: boolean;

  notify: (kind: Toast["kind"], message: string) => void;
  dismiss: (id: number) => void;
  /** Survol ou focus des notifications : leur disparition automatique est suspendue (RGAA 13.1). */
  holdToasts: (held: boolean) => void;
  ask: (options: DialogOptions) => Promise<DialogResult | null>;
  closeDialog: (result: DialogResult | null) => void;
  setBusy: (label: string | null) => void;
  setInteractiveRebaseBase: (hash: string | null) => void;
  setPanel: (patch: Partial<BottomPanelState>) => void;
  setSideWidth: (side: Side, width: number) => void;
  setGraphWidth: (width: number | null) => void;
  setPreferencesOpen: (open: boolean, section?: PreferencesSection) => void;
  setMemoOpen: (open: boolean) => void;
}

let nextToastId = 1;

/** Durée d'affichage d'une notification d'information ou de succès ; une erreur reste jusqu'à sa fermeture. */
const TOAST_DELAY = 5000;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
let toastsHeld = false;

export const useUiStore = create<UiStore>((set, get) => ({
  toasts: [],
  dialog: null,
  busy: null,
  interactiveRebaseBase: null,
  panel: loadPanel(),
  sideWidths: loadSideWidths(),
  graphWidth: loadGraphWidth(),
  preferencesOpen: false,
  preferencesSection: "appearance",
  memoOpen: false,

  notify: (kind, message) => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    if (kind !== "error" && !toastsHeld) toastTimers.set(id, setTimeout(() => get().dismiss(id), TOAST_DELAY));
  },

  dismiss: (id) => {
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  holdToasts: (held) => {
    toastsHeld = held;
    toastTimers.forEach(clearTimeout);
    toastTimers.clear();
    if (held) return;
    for (const t of get().toasts) {
      if (t.kind !== "error") toastTimers.set(t.id, setTimeout(() => get().dismiss(t.id), TOAST_DELAY));
    }
  },

  ask: (options) =>
    new Promise((resolve) => {
      get().dialog?.resolve(null);
      set({ dialog: { ...options, resolve } });
    }),

  closeDialog: (result) => {
    get().dialog?.resolve(result);
    set({ dialog: null });
  },

  setBusy: (busy) => set({ busy }),
  setInteractiveRebaseBase: (interactiveRebaseBase) => set({ interactiveRebaseBase }),

  setPreferencesOpen: (preferencesOpen, preferencesSection = "appearance") => set({ preferencesOpen, preferencesSection }),
  setMemoOpen: (memoOpen) => set({ memoOpen }),

  setPanel: (patch) => {
    const panel = { ...get().panel, ...patch };
    set({ panel });
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(panel));
    } catch {
      // stockage indisponible : réglage gardé pour la session
    }
  },

  setSideWidth: (side, width) => {
    const sideWidths = { ...get().sideWidths, [side]: clampSideWidth(side, width) };
    set({ sideWidths });
    try {
      localStorage.setItem(SIDES_KEY, JSON.stringify(sideWidths));
    } catch {
      // stockage indisponible : réglage gardé pour la session
    }
  },

  setGraphWidth: (width) => {
    const graphWidth = clampGraphWidth(width);
    set({ graphWidth });
    try {
      if (graphWidth === null) localStorage.removeItem(GRAPH_KEY);
      else localStorage.setItem(GRAPH_KEY, JSON.stringify(graphWidth));
    } catch {
      // stockage indisponible : réglage gardé pour la session
    }
  },
}));

/** Fenêtre de confirmation simple. */
export async function confirmAction(title: string, message?: string, danger = false): Promise<boolean> {
  const result = await useUiStore.getState().ask({ title, message, danger, confirmLabel: danger ? "Confirmer" : "OK" });
  return result !== null;
}

/** Demande une valeur texte ; renvoie null si annulé ou vide. */
export async function promptText(title: string, options: { placeholder?: string; initial?: string; message?: string } = {}): Promise<string | null> {
  const result = await useUiStore.getState().ask({
    title,
    message: options.message,
    input: { placeholder: options.placeholder, initial: options.initial },
  });
  const value = result?.value.trim();
  return value ? value : null;
}
