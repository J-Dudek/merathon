import { nameToEmoji } from "gemoji";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";

/**
 * Plugin remark : remplace les codes `:tada:` par leur emoji, avec la liste de GitHub, que GitLab reprend.
 * Seul le texte est concerné, pas le code. Un code inconnu (`12:30:45`, `:foo:`) reste tel quel.
 */
export function remarkEmojiShortcodes() {
  return (tree: Root) => {
    findAndReplace(tree, [[/:([a-z0-9_+-]+):/g, (_match: string, name: string) => nameToEmoji[name] ?? false]]);
  };
}

/**
 * Adresse absolue d'un lien écrit dans une PR / MR, résolue depuis la page de celle-ci.
 * Sur GitLab, les fichiers joints (`/uploads/…`) sont relatifs au projet, pas au serveur.
 */
export function resolveForgeLink(href: string, prUrl: string): string | null {
  const projectUrl = prUrl.split("/-/")[0];
  const target = href.startsWith("/uploads/") && prUrl.includes("/-/") ? projectUrl + href : href;
  try {
    return new URL(target, prUrl).href;
  } catch {
    return null;
  }
}
