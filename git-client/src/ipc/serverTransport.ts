/**
 * Transport vers `merathon-server` (NAS) : les commandes sont des `POST api/invoke/<nom>`, et les événements comme
 * les flux (surveillance du dossier, terminal) arrivent par un WebSocket propre à l'onglet. Les URL sont relatives
 * à la page : le service peut être servi à la racine ou derrière un préfixe (`/merathon/`).
 */

/** Libellé de l'onglet auprès du serveur : il rattache les flux et les terminaux à cet onglet, et les ferme avec lui. */
/** Hexadécimal aléatoire. `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS) : servi en HTTP sur le réseau local, il est absent. */
function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (b) => b.toString(16).padStart(2, "0")).join("");
}

const label = `tab-${randomHex(8)}`;

/** Émis quand le serveur refuse une requête faute de connexion. */
export const AUTH_REQUIRED_EVENT = "merathon:auth-required";
/** Émis quand le WebSocket s'est reconnecté : les flux ouverts avant la coupure n'existent plus côté serveur. */
export const RECONNECTED_EVENT = "merathon:reconnected";

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/** Flux ouvert par une commande : le serveur y envoie des messages, identifiés par ce numéro. */
class ServerChannel<T> {
  constructor(
    readonly id: number,
    readonly onmessage: (message: T) => void,
  ) {}
  /** Les arguments sont sérialisés tels quels : le serveur n'a besoin que du numéro. */
  toJSON() {
    return this.id;
  }
}

const channels = new Map<number, (message: never) => void>();
const listeners = new Map<string, Set<(payload: never) => void>>();
let nextChannel = 1;
let socket: Promise<WebSocket> | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let everConnected = false;

export function url(path: string): URL {
  return new URL(path, document.baseURI);
}

function dispatch(raw: string) {
  let message: { t?: string; id?: unknown; data?: unknown };
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.t === "channel" && typeof message.id === "number") {
    (channels.get(message.id) as ((m: unknown) => void) | undefined)?.(message.data);
  } else if (message.t === "event" && typeof message.id === "string") {
    listeners.get(message.id)?.forEach((handler) => (handler as (p: unknown) => void)(message.data));
  }
}

/** Connexion du WebSocket (une seule, partagée) ; rétablie d'elle-même tant que des flux ou des écouteurs en dépendent. */
function connect(): Promise<WebSocket> {
  if (socket) return socket;
  socket = new Promise<WebSocket>((resolve, reject) => {
    const target = url(`api/ws?window=${label}`);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(target);
    ws.onopen = () => {
      reconnectDelay = RECONNECT_MIN_MS;
      if (everConnected) window.dispatchEvent(new Event(RECONNECTED_EVENT));
      everConnected = true;
      resolve(ws);
    };
    ws.onmessage = (event) => dispatch(String(event.data));
    ws.onerror = () => reject(new Error("WebSocket"));
    ws.onclose = () => {
      socket = null;
      reject(new Error("WebSocket"));
      if (channels.size === 0 && listeners.size === 0) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
      setTimeout(() => void connect().catch(() => {}), delay);
    };
  });
  // Le rejet est géré par l'appelant ; sans cette ligne, une coupure non attendue ferait une erreur « non gérée ».
  socket.catch(() => {});
  return socket;
}

function hasChannel(args: Record<string, unknown>): boolean {
  return Object.values(args).some((value) => value instanceof ServerChannel);
}

function errorFrom(status: number, body: unknown): unknown {
  if (body !== null && body !== undefined && body !== "") return body;
  return `HTTP ${status}`;
}

/** Appelle une commande. Une erreur de la commande est rejetée telle que le serveur la renvoie (texte ou objet), comme Tauri. */
export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  // Un flux n'existe que si le WebSocket de l'onglet est connecté : le serveur y envoie ses messages.
  if (hasChannel(args)) await connect();
  let response: Response;
  try {
    response = await fetch(url(`api/invoke/${cmd}`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Merathon-Window": label },
      credentials: "same-origin",
      body: JSON.stringify(args),
    });
  } catch (e) {
    throw `${e instanceof Error ? e.message : String(e)} (${cmd})`;
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Réponse qui n'est pas du JSON (page d'erreur d'un reverse proxy) : le texte brut sert de message.
  }
  if (response.ok) return body as T;
  if (response.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  throw errorFrom(response.status, body);
}

export function createChannel<T>(onmessage: (message: T) => void): unknown {
  const id = nextChannel++;
  channels.set(id, onmessage as (message: never) => void);
  return new ServerChannel<T>(id, onmessage);
}

/** Libère un flux dont l'interface n'attend plus rien. */
export function closeChannel(channel: unknown) {
  if (channel instanceof ServerChannel) channels.delete(channel.id);
}

/** Écoute un événement diffusé par le serveur ; renvoie la fonction qui l'arrête. */
export function listen<T>(event: string, handler: (payload: T) => void): () => void {
  const set = listeners.get(event) ?? new Set();
  set.add(handler as (payload: never) => void);
  listeners.set(event, set);
  void connect().catch(() => {});
  return () => {
    set.delete(handler as (payload: never) => void);
    if (set.size === 0) listeners.delete(event);
  };
}

// ---------------------------------------------------------------- Session

export type SessionStatus = {
  auth: "none" | "token" | "dsm";
  authenticated: boolean;
  user: string | null;
  /** Connecté à DSM, mais pas autorisé à utiliser Merathon. */
  forbidden: boolean;
};

export async function fetchSession(): Promise<SessionStatus> {
  const response = await fetch(url("api/session"), { credentials: "same-origin" });
  if (!response.ok) throw `HTTP ${response.status}`;
  return (await response.json()) as SessionStatus;
}

/** Échange le jeton contre une session ; rejette avec le message du serveur si le jeton est refusé. */
export async function login(token: string): Promise<void> {
  const response = await fetch(url("api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw await response.json().catch(() => `HTTP ${response.status}`);
}

export async function logout(): Promise<void> {
  await fetch(url("api/logout"), { method: "POST", credentials: "same-origin" });
}
