/**
 * Où vont les appels au backend : Tauri (bureau, Android) ou `merathon-server` (NAS, voir serverTransport.ts).
 * Le choix se fait à chaque appel, pour pouvoir simuler l'une ou l'autre plateforme dans les tests.
 */
import { Channel, invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isServer } from "../lib/platform";
import * as server from "./serverTransport";

export type { InvokeArgs };

export function invokeRaw<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  return isServer() ? server.invoke<T>(cmd, args as Record<string, unknown> | undefined) : tauriInvoke<T>(cmd, args);
}

/** Flux de messages du backend. L'objet renvoyé se passe en argument de la commande qui ouvre le flux. */
export function createChannel<T>(onmessage: (message: T) => void): unknown {
  if (isServer()) return server.createChannel(onmessage);
  const channel = new Channel<T>();
  channel.onmessage = onmessage;
  return channel;
}

/** Libère un flux dont plus rien n'est attendu (sans effet avec Tauri, où il disparaît avec la fenêtre). */
export function closeChannel(channel: unknown) {
  if (isServer()) server.closeChannel(channel);
}

/** Écoute un événement diffusé par le backend ; renvoie la fonction qui l'arrête. */
export async function listenEvent<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (isServer()) return server.listen(event, handler);
  return listen<T>(event, (e) => handler(e.payload));
}
