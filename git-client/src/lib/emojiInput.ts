// Saisie d'un emoji sans les données des emojis (lib/emoji.ts, chargé à la demande) : repérer « :mot » et insérer.

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

/** Remplace `start`…`end` par l'emoji et renvoie le texte et la position du curseur après l'emoji. */
export function insertEmoji(text: string, start: number, end: number, emoji: string, spaceAfter = false): { text: string; caret: number } {
  const after = text.slice(end);
  const inserted = emoji + (spaceAfter && !/^\s/.test(after) ? " " : "");
  return { text: text.slice(0, start) + inserted + after, caret: start + inserted.length };
}
