/** Initiales affichées dans les points du graphe : « Julien Dudek » → « JD », « julien.dudek » → « JD », « Julien » → « J ». */
export function authorInitials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (w: string) => Array.from(w)[0].toUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}
