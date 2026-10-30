import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { closeDesktopNotification, notifyDesktop } from "../ipc/commands";
import { useAccountsStore } from "../store/useAccountsStore";
import { useDisplayStore, type NotificationSettings } from "../store/useDisplayStore";
import { prFreshness, seenKey, useSeenPrsStore, type SeenPr } from "../store/useSeenPrsStore";
import { useUiStore } from "../store/useUiStore";
import { cachedMyPullRequests, fetchMyPullRequests, publishMyPullRequests } from "./myPullRequests";
import type { ForgeAccount, MyPullRequests, PrSummary } from "../types/forge";

export type PrEventKind =
  | "opened" | "commits" | "comments" | "activity" | "ci_success" | "ci_failure" | "approved" | "changes_requested";

export interface PrEvent {
  pr: PrSummary;
  kinds: PrEventKind[];
}

/** Réglage des préférences qui active chaque type d'événement. */
const SETTING: Record<PrEventKind, Exclude<keyof NotificationSettings, "enabled" | "badge">> = {
  opened: "opened",
  commits: "commits",
  comments: "comments",
  activity: "comments",
  ci_success: "ci",
  ci_failure: "ci",
  approved: "review",
  changes_requested: "review",
};

const prKey = (pr: PrSummary) => `${pr.projectPath}#${pr.number}`;

/** Ce qui a changé sur une PR entre deux listes ; `authored` : ouverte par moi (mes propres commits ne sont pas signalés, ni mes pushs). */
function changes(prev: PrSummary, pr: PrSummary, authored: boolean): PrEventKind[] {
  const kinds: PrEventKind[] = [];
  const commits = pr.headSha !== prev.headSha;
  if (commits && !authored && !pr.pushedByMe) kinds.push("commits");
  if (pr.commentCount !== undefined && prev.commentCount !== undefined) {
    if (pr.commentCount > prev.commentCount) kinds.push("comments");
  } else if (pr.updatedAt > prev.updatedAt && !commits && pr.ci === prev.ci && pr.review === prev.review) {
    // Nombre de commentaires inconnu (GitHub, PR jamais consultée) : la PR a bougé sans autre raison visible.
    kinds.push("activity");
  }
  return [...kinds, ...statusChanges(prev, pr)];
}

/** CI terminée et nouvelle décision de relecture. */
function statusChanges(prev: PrSummary, pr: PrSummary): PrEventKind[] {
  const kinds: PrEventKind[] = [];
  if (pr.ci !== prev.ci && pr.ci === "success") kinds.push("ci_success");
  if (pr.ci !== prev.ci && pr.ci === "failure") kinds.push("ci_failure");
  if (pr.review !== prev.review && pr.review === "approved") kinds.push("approved");
  if (pr.review !== prev.review && pr.review === "changes_requested") kinds.push("changes_requested");
  return kinds;
}

/** Événements entre deux listes de « mes PR » : PR à traiter apparues, commits, commentaires, CI, relecture. */
export function pullRequestEvents(before: MyPullRequests, after: MyPullRequests): PrEvent[] {
  const old = new Map([...before.assigned, ...before.authored].map((pr) => [prKey(pr), pr]));
  const authored = new Set(after.authored.map(prKey));
  const done = new Set<string>();
  const events: PrEvent[] = [];
  for (const pr of [...after.assigned, ...after.authored]) {
    const key = prKey(pr);
    if (done.has(key)) continue;
    done.add(key);
    const prev = old.get(key);
    let kinds: PrEventKind[] = [];
    if (prev) kinds = changes(prev, pr, authored.has(key));
    else if (!authored.has(key)) kinds = ["opened"];
    if (kinds.length) events.push({ pr, kinds });
  }
  return events;
}

/** Événements que les préférences laissent passer. */
export function filterEvents(events: PrEvent[], settings: NotificationSettings): PrEvent[] {
  if (!settings.enabled) return [];
  return events
    .map(({ pr, kinds }) => ({ pr, kinds: kinds.filter((k) => settings[SETTING[k]]) }))
    .filter((e) => e.kinds.length > 0);
}

function kindLabel(kind: PrEventKind, prLabel: string): string {
  switch (kind) {
    case "opened": return `nouvelle ${prLabel} à traiter`;
    case "commits": return "nouveaux commits";
    case "comments": return "nouveaux commentaires";
    case "activity": return "nouvelle activité";
    case "ci_success": return "CI passée";
    case "ci_failure": return "CI en échec";
    case "approved": return "approuvée";
    case "changes_requested": return "modifications demandées";
  }
}

const MAX_LINES = 4;

/** Titre et texte d'une notification : le détail d'une seule PR, ou une ligne par PR. */
export function notificationText(events: PrEvent[], provider: ForgeAccount["provider"]): { title: string; body: string } {
  const prLabel = provider === "gitlab" ? "MR" : "PR";
  const sign = provider === "gitlab" ? "!" : "#";
  const kinds = (e: PrEvent) => e.kinds.map((k) => kindLabel(k, prLabel)).join(", ");
  if (events.length === 1) {
    const [e] = events;
    const detail = kinds(e);
    return { title: `${prLabel} ${sign}${e.pr.number} · ${e.pr.title}`, body: `${detail[0].toUpperCase()}${detail.slice(1)} — ${e.pr.projectPath}` };
  }
  const lines = events.slice(0, MAX_LINES).map((e) => `${sign}${e.pr.number} ${e.pr.title} : ${kinds(e)}`);
  const rest = events.length - MAX_LINES;
  if (rest > 0) lines.push(`… et ${rest} autre${rest > 1 ? "s" : ""}`);
  return { title: `${events.length} ${prLabel} mises à jour`, body: lines.join("\n") };
}

let permission: Promise<boolean> | null = null;

/** Autorisation d'afficher des notifications système, demandée une seule fois par session. */
function notificationsAllowed(): Promise<boolean> {
  permission ??= (async () => (await isPermissionGranted()) || (await requestPermission()) === "granted")().catch(() => false);
  return permission;
}

/** PR mentionnée par une notification système, sous sa clé de consultation. */
export interface NotifiedPr {
  key: string;
  pr: PrSummary;
}

/** Notifications système encore affichées (Linux) : retirées quand toutes leurs PR ont été consultées. */
const shown: { id: number; prs: NotifiedPr[] }[] = [];

/** Notifications dont toutes les PR ont été consultées depuis (dans l'état notifié ou plus récent). */
export function readNotifications(list: { id: number; prs: NotifiedPr[] }[], seen: Record<string, SeenPr>): number[] {
  return list.filter((n) => n.prs.every(({ key, pr }) => prFreshness(seen[key], pr).kind === "read")).map((n) => n.id);
}

// Le dock d'Ubuntu affiche sur l'icône le nombre de notifications de l'appli encore dans la liste de GNOME :
// une notification sur une PR qu'on vient de consulter y est retirée, sinon le compteur laisse croire à du nouveau.
useSeenPrsStore.subscribe(({ seen }) => {
  for (const id of readNotifications(shown, seen)) {
    shown.splice(shown.findIndex((n) => n.id === id), 1);
    closeDesktopNotification(id).catch((e) => console.warn("Notification non retirée :", e));
  }
});

/** Notification système si la fenêtre est en arrière-plan (ou réduite), simple toast sinon. */
async function deliver(title: string, body: string, prs: NotifiedPr[]) {
  if (!document.hasFocus() && (await notificationsAllowed())) {
    try {
      const id = await notifyDesktop(title, body);
      if (id !== null) shown.push({ id, prs });
      return;
    } catch (e) {
      console.warn("Notification système impossible :", e);
    }
  }
  useUiStore.getState().notify("info", `${title} — ${body.replace(/\n/g, " · ")}`);
}

/** Envoie une notification système d'essai ; faux si elle n'est pas autorisée. */
export async function sendTestNotification(): Promise<boolean> {
  if (!(await notificationsAllowed())) return false;
  await notifyDesktop("Merathon", "Les notifications de l'activité des PR / MR fonctionnent.");
  return true;
}

// ---------------------------------------------------------------- Dernière liste connue, partagée entre les fenêtres

const KEY = "merathon.myPullRequests";
/** Une autre fenêtre vient de recharger la liste : on la reprend telle quelle, sans appel ni notification en double. */
const FRESH_MS = 15_000;

interface Snapshot {
  at: number;
  data: MyPullRequests;
}

function readSnapshots(): Record<string, Snapshot> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Snapshot>;
  } catch {
    return {};
  }
}

function writeSnapshot(accountId: string, data: MyPullRequests) {
  const accounts = new Set(useAccountsStore.getState().accounts.map((a) => a.id));
  const kept = Object.fromEntries(Object.entries(readSnapshots()).filter(([id]) => accounts.has(id)));
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...kept, [accountId]: { at: Date.now(), data } }));
  } catch {
    // stockage indisponible : la prochaine synchronisation repartira de zéro
  }
}

/** Reprend les dernières listes connues des comptes pas encore chargés : pastille et onglet Comptes à jour dès le démarrage. */
export function restoreMyPullRequests(accountIds: string[]) {
  const snapshots = readSnapshots();
  for (const id of accountIds) {
    if (snapshots[id] && !cachedMyPullRequests(id)) publishMyPullRequests(id, snapshots[id].data);
  }
}

/** Les fenêtres synchronisent chacune de leur côté : une seule à la fois compare et notifie. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request("merathon.my-pull-requests", fn) : fn();
}

/** Recharge « mes PR » d'un compte et notifie ce qui a changé depuis la dernière liste connue (même d'une session précédente). */
async function refreshAccount(account: ForgeAccount, settings: NotificationSettings): Promise<MyPullRequests> {
  const previous = readSnapshots()[account.id] as Snapshot | undefined;
  if (previous && Date.now() - previous.at < FRESH_MS) {
    publishMyPullRequests(account.id, previous.data);
    return previous.data;
  }
  const data = await fetchMyPullRequests(account);
  writeSnapshot(account.id, data);
  publishMyPullRequests(account.id, data);
  if (previous) {
    const events = filterEvents(pullRequestEvents(previous.data, data), settings);
    if (events.length) {
      const { title, body } = notificationText(events, account.provider);
      await deliver(title, body, events.map(({ pr }) => ({ key: seenKey(account.id, pr.projectPath, pr.number), pr })));
    }
  }
  return data;
}

/**
 * Activité de mes PR / MR sur chaque compte, si les notifications sont activées.
 * Renvoie les clés (`seenKey`, en minuscules) des PR suivies, que la synchronisation des dépôts ne signale plus.
 */
export async function syncMyPullRequests(): Promise<Set<string>> {
  const settings = useDisplayStore.getState().notifications;
  const followed = new Set<string>();
  if (!settings.enabled) return followed;
  for (const account of useAccountsStore.getState().accounts) {
    try {
      const data = await exclusive(() => refreshAccount(account, settings));
      for (const pr of [...data.assigned, ...data.authored]) followed.add(seenKey(account.id, pr.projectPath, pr.number).toLowerCase());
    } catch (e) {
      console.warn(`PR / MR de ${account.label} indisponibles :`, e);
    }
  }
  return followed;
}
