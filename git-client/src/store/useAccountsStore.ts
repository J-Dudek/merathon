import { create } from "zustand";
import type { ForgeAccount, AccountData, Provider, SavedAccount } from "../types/forge";
import { addPatAccount, listAccounts, removeAccount, renameAccount, updateAccountToken } from "../ipc/commands";
import { forgeClient, type ForgeClient } from "../api/forge";
import { useUiStore } from "./useUiStore";
import { trimEndChars } from "../lib/strings";

interface AccountsStore {
  accounts: ForgeAccount[];
  loaded: boolean;
  data: Record<string, AccountData>;
  activeId: string | null;

  load: () => Promise<void>;
  /** Le backend valide le token auprès de l'instance puis l'enregistre dans le trousseau. */
  add: (input: { provider: Provider; baseUrl: string; token: string; label?: string }) => Promise<ForgeAccount>;
  /** Ajoute un compte déjà enregistré côté Rust (connexion OAuth). */
  addConnected: (saved: SavedAccount) => void;
  updateToken: (account: ForgeAccount, token: string) => Promise<void>;
  rename: (account: ForgeAccount, label: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  client: (account: ForgeAccount) => Promise<ForgeClient>;
  setData: (id: string, data: Partial<AccountData>) => void;
  setActive: (id: string | null) => void;
}

function emptyData(): AccountData {
  return { issues: [], loading: false, error: null };
}

export function defaultBaseUrl(provider: Provider): string {
  return provider === "github" ? "https://github.com" : "https://gitlab.com";
}

/** Prévient si le secret n'a pas pu aller dans le trousseau du système. */
function warnIfInsecure(saved: SavedAccount) {
  if (!saved.secure_storage) {
    useUiStore
      .getState()
      .notify(
        "info",
        "Aucun trousseau système disponible : le token est stocké dans un fichier lisible uniquement par ton utilisateur. Installe/active un trousseau (GNOME Keyring, KWallet…) pour plus de sécurité.",
      );
  }
}

export const useAccountsStore = create<AccountsStore>((set) => ({
  accounts: [],
  loaded: false,
  data: {},
  activeId: null,

  load: async () => {
    const accounts = await listAccounts();
    set((s) => ({
      accounts,
      loaded: true,
      activeId: s.activeId && accounts.some((a) => a.id === s.activeId) ? s.activeId : accounts[0]?.id ?? null,
    }));
  },

  add: async ({ provider, baseUrl, token, label }) => {
    const base = trimEndChars(provider === "github" ? defaultBaseUrl("github") : baseUrl.trim());
    const saved = await addPatAccount(provider, base, token, label?.trim() || null);
    warnIfInsecure(saved);
    set((s) => ({ accounts: [...s.accounts, saved.account], activeId: saved.account.id }));
    return saved.account;
  },

  addConnected: (saved) => {
    warnIfInsecure(saved);
    set((s) => ({ accounts: [...s.accounts, saved.account], activeId: saved.account.id }));
  },

  updateToken: async (account, token) => {
    const saved = await updateAccountToken(account.id, token);
    warnIfInsecure(saved);
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === saved.account.id ? saved.account : a)) }));
  },

  rename: async (account, label) => {
    const saved = await renameAccount(account.id, label);
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === saved.account.id ? saved.account : a)) }));
  },

  remove: async (id) => {
    await removeAccount(id);
    set((s) => {
      const accounts = s.accounts.filter((a) => a.id !== id);
      const data = { ...s.data };
      delete data[id];
      const activeId = s.activeId === id ? accounts[0]?.id ?? null : s.activeId;
      return { accounts, data, activeId };
    });
  },

  client: async (account) => forgeClient(account),

  setData: (id, patch) =>
    set((s) => ({
      data: { ...s.data, [id]: { ...emptyData(), ...s.data[id], ...patch } },
    })),

  setActive: (activeId) => set({ activeId }),
}));
