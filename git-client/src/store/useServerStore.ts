import { create } from "zustand";
import type { ServerInfo } from "../ipc/commands";

/** Ce que le serveur du NAS dit de lui-même (version, utilisateur, terminal autorisé) ; vide hors du mode serveur. */
export const useServerStore = create<{ info: ServerInfo | null }>(() => ({ info: null }));
