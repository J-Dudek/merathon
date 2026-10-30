import type { ReviewThread } from "../types/forge";
import type { CommitTrailers } from "../types/git";

/**
 * Fils de revue traités par un commit, notés en trailers à la fin de son message :
 * `Resolves-Thread: <id>` (réponse puis résolution) ou `Addresses-Thread: <id>` (réponse seule).
 * L'id est `ReviewThread.id` : id GraphQL du fil (GitHub), id de la discussion (GitLab).
 */
export type ThreadAction = "resolve" | "address";

/** Fils liés à un commit, par id. */
export type ThreadLinks = Record<string, ThreadAction>;

export const THREAD_TRAILER_KEYS: Record<ThreadAction, string> = {
  resolve: "Resolves-Thread",
  address: "Addresses-Thread",
};

/** Commentaire HTML invisible ajouté aux réponses : une seule réponse par fil, même après un nouveau push. */
export const THREAD_REPLY_MARKER = "<!-- merathon:thread-reply -->";

const TRAILER_LINE = /^(Resolves|Addresses)-Thread:[ \t]*(\S+)[ \t]*$/gim;
const ANY_TRAILER = /^[A-Za-z0-9-]+: .+$/;

function actionOf(key: string): ThreadAction | null {
  const k = key.toLowerCase();
  if (k === THREAD_TRAILER_KEYS.resolve.toLowerCase()) return "resolve";
  if (k === THREAD_TRAILER_KEYS.address.toLowerCase()) return "address";
  return null;
}

/** Ajoute un lien ; « résoudre » l'emporte sur « répondre » pour un même fil. */
function addLink(links: ThreadLinks, id: string, action: ThreadAction) {
  if (links[id] !== "resolve") links[id] = action;
}

/** Fils liés par une liste de trailers (clé, valeur), comme les renvoie `commitTrailers`. */
export function threadLinksOf(trailers: [string, string][]): ThreadLinks {
  const links: ThreadLinks = {};
  for (const [key, value] of trailers) {
    const action = actionOf(key);
    if (action && value.trim()) addLink(links, value.trim(), action);
  }
  return links;
}

/** Réunit les fils liés par plusieurs messages. */
export function mergeThreadLinks(...all: ThreadLinks[]): ThreadLinks {
  const links: ThreadLinks = {};
  for (const l of all) for (const [id, action] of Object.entries(l)) addLink(links, id, action);
  return links;
}

/** Retire les trailers de fils du texte (où qu'ils soient) et les renvoie à part : message d'un commit à modifier. */
export function extractThreadTrailers(message: string): { text: string; links: ThreadLinks } {
  const links: ThreadLinks = {};
  const text = message
    .replace(TRAILER_LINE, (_, kind: string, id: string) => {
      addLink(links, id, kind.toLowerCase() === "resolves" ? "resolve" : "address");
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, links };
}

/** Brouillon de commit tiré d'un message existant (amend, commit annulé) : les fils sont mis à part du texte. */
export function draftFromMessage(message: string): { summary: string; description: string; threads: ThreadLinks } {
  const { text, links } = extractThreadTrailers(message);
  const [summary, ...rest] = text.split("\n");
  return { summary, description: rest.join("\n").trim(), threads: links };
}

/** Ajoute les trailers des fils à la fin du message, dans le bloc de trailers existant s'il y en a un (Co-Authored-By…). */
export function appendThreadTrailers(message: string, links: ThreadLinks): string {
  const lines = Object.entries(links).map(([id, action]) => `${THREAD_TRAILER_KEYS[action]}: ${id}`);
  const text = message.trimEnd();
  if (!lines.length) return text;
  const paragraphs = text.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1];
  const inTrailerBlock = paragraphs.length > 1 && last.split("\n").every((l) => ANY_TRAILER.test(l));
  return `${text}${inTrailerBlock ? "\n" : "\n\n"}${lines.join("\n")}`;
}

/** Ce qu'il reste à faire sur un fil après un push. */
export interface ThreadReplyPlan {
  thread: ReviewThread;
  /** Commits qui traitent le fil, du plus ancien au plus récent ; vide si une réponse existe déjà. */
  hashes: string[];
  resolve: boolean;
}

export function hasThreadReply(thread: ReviewThread): boolean {
  return thread.comments.some((c) => c.body.includes(THREAD_REPLY_MARKER));
}

/**
 * Réponses et résolutions à publier pour les commits poussés (du plus récent au plus ancien, ordre du revwalk).
 * Les fils absents de la PR sont ignorés (commit cherry-pické, ou venu de la branche cible avec un rebase).
 */
export function planThreadReplies(commits: CommitTrailers[], threads: ReviewThread[]): ThreadReplyPlan[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const plans = new Map<string, ThreadReplyPlan>();
  for (const commit of [...commits].reverse()) {
    for (const [id, action] of Object.entries(threadLinksOf(commit.trailers))) {
      const thread = byId.get(id);
      if (!thread) continue;
      const plan = plans.get(id) ?? { thread, hashes: [], resolve: false };
      plan.hashes.push(commit.hash);
      plan.resolve ||= action === "resolve";
      plans.set(id, plan);
    }
  }
  return [...plans.values()]
    .map((p) => ({
      ...p,
      hashes: hasThreadReply(p.thread) ? [] : p.hashes,
      resolve: p.resolve && p.thread.resolved === false,
    }))
    .filter((p) => p.hashes.length > 0 || p.resolve);
}

/** Réponse publiée sur le fil : les forges transforment les SHA en liens vers les commits. */
export function threadReplyBody(hashes: string[]): string {
  return `Traité dans ${hashes.join(", ")}.\n\n${THREAD_REPLY_MARKER}`;
}
