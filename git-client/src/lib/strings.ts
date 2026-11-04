/** Retire les caractères `chars` en fin de chaîne (ex. les `/` d'une URL), sans expression régulière. */
export function trimEndChars(value: string, chars = "/"): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end--;
  return value.slice(0, end);
}
