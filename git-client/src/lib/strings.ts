/** Retire les caractères `chars` en fin de chaîne (ex. les `/` d'une URL), sans expression régulière. */
export function trimEndChars(value: string, chars = "/"): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end--;
  return value.slice(0, end);
}

/** « 1 fichier », « 3 fichiers ». */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}
