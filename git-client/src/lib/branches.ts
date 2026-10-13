import type { BranchInfo } from "../types/git";

/** Branches locales jamais publiées : pas de branche suivie, ni de branche du même nom sur un remote. */
export function localOnlyBranches(branches: BranchInfo[]): Set<string> {
  const onRemote = new Set(branches.filter((b) => b.is_remote).map((b) => b.name.slice(b.name.indexOf("/") + 1)));
  return new Set(branches.filter((b) => !b.is_remote && !b.upstream && !onRemote.has(b.name)).map((b) => b.name));
}

export type BranchNode<T> =
  | { kind: "folder"; name: string; path: string; children: BranchNode<T>[]; count: number }
  | { kind: "branch"; name: string; item: T };

/** Range les branches en dossiers selon les « / » de leur nom : feat/a et feat/b vont dans le dossier feat. */
export function branchTree<T>(items: T[], nameOf: (item: T) => string): BranchNode<T>[] {
  const root: BranchNode<T>[] = [];
  for (const item of items) {
    const parts = nameOf(item).split("/");
    let level = root;
    let path = "";
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part;
      let folder = level.find((n) => n.kind === "folder" && n.name === part);
      if (!folder) {
        folder = { kind: "folder", name: part, path, children: [], count: 0 };
        level.push(folder);
      }
      if (folder.kind === "folder") {
        folder.count++;
        level = folder.children;
      }
    }
    level.push({ kind: "branch", name: parts[parts.length - 1], item });
  }
  return root;
}

/** Branches dans l'ordre d'affichage de l'arbre. */
export function flattenTree<T>(nodes: BranchNode<T>[]): T[] {
  return nodes.flatMap((n) => (n.kind === "branch" ? [n.item] : flattenTree(n.children)));
}

/** Titre proposé pour une PR : « feat/login-page » → « feat: login page ». */
export function pullRequestTitle(branch: string): string {
  const slash = branch.lastIndexOf("/");
  const words = (s: string) => s.replace(/[-_]+/g, " ").trim();
  const subject = words(branch.slice(slash + 1));
  if (slash < 0) return subject;
  const type = branch.slice(0, slash).split("/")[0];
  return `${type}: ${subject}`;
}

/**
 * Nom d'une branche sur le remote d'une forge, pour la rapprocher des branches source des PR / MR.
 * Branche locale : sa branche suivie sur ce remote, ou son propre nom si elle n'en suit aucune.
 * Renvoie null si la branche appartient à un autre remote.
 */
export function branchOnRemote(b: BranchInfo, remoteName: string): string | null {
  const prefix = `${remoteName}/`;
  if (b.is_remote) return b.name.startsWith(prefix) ? b.name.slice(prefix.length) : null;
  if (!b.upstream) return b.name;
  return b.upstream.startsWith(prefix) ? b.upstream.slice(prefix.length) : null;
}

/** PR / MR par branche source (une branche peut en avoir plusieurs, vers des cibles différentes). */
export function pullRequestsByBranch<T extends { sourceBranch: string }>(prs: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const pr of prs) map.set(pr.sourceBranch, [...(map.get(pr.sourceBranch) ?? []), pr]);
  return map;
}
