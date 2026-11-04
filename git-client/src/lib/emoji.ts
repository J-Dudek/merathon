import { emojiToName, gemoji, type Gemoji } from "gemoji";
import { fold } from "./issueRefs";
import { tr } from "../i18n";

/** Emoji en cours de saisie : le « : » (à `start`) et ce qui le suit jusqu'au curseur. */
export interface EmojiQuery {
  start: number;
  query: string;
}

/**
 * « :mot » juste avant le curseur, en début de mot et avec au moins deux caractères : ni « 12:30 », ni « fix: », ni les
 * émoticônes « :) », « :D » ou « :-D ».
 */
export function emojiQueryAt(text: string, caret: number): EmojiQuery | null {
  const m = /(?:^|[\s([{]):([\p{L}\p{N}+][\p{L}\p{N}_+-]+)$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

/** Les noms de gemoji sont en anglais : mots français des emojis les plus courants. */
const FRENCH_WORDS: Record<string, string> = {
  amour: "❤️", ampoule: "💡", attention: "⚠️", balai: "🧹", biere: "🍺", bravo: "👏", cafe: "☕", cerveau: "🧠",
  chantier: "🚧", chat: "🐱", chien: "🐶", cle: "🔑", coeur: "❤️", colere: "😠", colis: "📦", eclair: "⚡", erreur: "❌",
  etoile: "⭐", fete: "🎉", feu: "🔥", fusee: "🚀", graphique: "📈", idee: "💡", interdit: "🚫", livre: "📚", marteau: "🔨",
  merci: "🙏", non: "❌", note: "📝", nettoyer: "🧹", oui: "✅", paquet: "📦", pleurer: "😭", pouce: "👍", poubelle: "🗑️",
  reflechir: "🤔", reparer: "🔧", rire: "😂", salut: "👋", securite: "🔒", sourire: "😄", triste: "😢", valide: "✅", yeux: "👀",
};

const wordsByEmoji = new Map<string, string[]>();
for (const [word, emoji] of Object.entries(FRENCH_WORDS)) wordsByEmoji.set(emoji, [...(wordsByEmoji.get(emoji) ?? []), word]);

/** Mots français connus, pour vérifier qu'ils désignent bien un emoji de la liste. */
export const frenchEmojis = (): string[] => Object.values(FRENCH_WORDS);

/** Pertinence d'un emoji pour la recherche (0 : la meilleure), `null` s'il ne correspond pas. */
function rank(entry: Gemoji, q: string): number | null {
  const words = [...entry.names, ...(wordsByEmoji.get(entry.emoji) ?? [])];
  if (words.includes(q)) return 0;
  if (words.some((w) => w.startsWith(q))) return 1;
  if (entry.tags.some((t) => t.startsWith(q))) return 2;
  if (words.some((w) => w.includes(q)) || entry.description.toLowerCase().includes(q)) return 3;
  return null;
}

/** Emojis correspondant à la recherche (nom, mot français, mot-clé ou description), les plus pertinents en tête. */
export function searchEmojis(query: string, limit = Infinity): Gemoji[] {
  const q = fold(query.trim());
  if (!q) return [];
  const hits: { entry: Gemoji; score: number }[] = [];
  for (const entry of gemoji) {
    const score = rank(entry, q);
    if (score !== null) hits.push({ entry, score });
  }
  // Le tri est stable : à pertinence égale, l'ordre de gemoji (les visages d'abord) est conservé.
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.entry);
}

/** Catégories de gemoji, avec leur libellé et l'emoji de leur onglet. */
export const EMOJI_CATEGORIES = [
  { id: "Smileys & Emotion", label: tr("Visages"), icon: "😀" },
  { id: "People & Body", label: tr("Personnes"), icon: "👋" },
  { id: "Animals & Nature", label: tr("Animaux et nature"), icon: "🌿" },
  { id: "Food & Drink", label: tr("Nourriture"), icon: "🍕" },
  { id: "Travel & Places", label: tr("Voyages et lieux"), icon: "🚗" },
  { id: "Activities", label: tr("Activités"), icon: "🎉" },
  { id: "Objects", label: tr("Objets"), icon: "💡" },
  { id: "Symbols", label: tr("Symboles"), icon: "✅" },
  { id: "Flags", label: tr("Drapeaux"), icon: "🏁" },
] as const;

export function emojisOfCategory(id: string): Gemoji[] {
  return gemoji.filter((e) => e.category === id);
}

const RECENT_KEY = "merathon.emoji.recent";
const MAX_RECENT = 24;
/** Proposés tant qu'aucun emoji n'a été choisi : les plus courants dans une revue ou un commit. */
const DEFAULT_RECENT = ["👍", "🎉", "🚀", "❤️", "😄", "🤔", "👀", "🙏", "✅", "❌", "⚠️", "🐛", "🔥", "✨", "🔧", "📝"];
const byEmoji = new Map(gemoji.map((e) => [e.emoji, e]));

/** Emojis récents, du plus récent au plus ancien ; les plus courants s'il n'y en a pas encore. */
export function recentEmojis(): Gemoji[] {
  let saved: unknown = [];
  try {
    saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    // stockage indisponible ou illisible : liste par défaut
  }
  const list = Array.isArray(saved) ? saved.filter((e): e is string => typeof e === "string" && e in emojiToName) : [];
  return (list.length ? list : DEFAULT_RECENT).flatMap((e) => byEmoji.get(e) ?? []);
}

export function rememberEmoji(emoji: string) {
  try {
    // La liste par défaut n'est pas un historique : elle n'est pas enregistrée avec le premier choix.
    const previous = localStorage.getItem(RECENT_KEY) === null ? [] : recentEmojis().map((e) => e.emoji).filter((e) => e !== emoji);
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...previous].slice(0, MAX_RECENT)));
  } catch {
    // stockage indisponible : récents gardés tels quels
  }
}

/** Remplace `start`…`end` par l'emoji et renvoie le texte et la position du curseur après l'emoji. */
export function insertEmoji(text: string, start: number, end: number, emoji: string, spaceAfter = false): { text: string; caret: number } {
  const after = text.slice(end);
  const inserted = emoji + (spaceAfter && !/^\s/.test(after) ? " " : "");
  return { text: text.slice(0, start) + inserted + after, caret: start + inserted.length };
}
