export type FileNode<T> =
  | { kind: "folder"; name: string; path: string; children: FileNode<T>[]; files: T[] }
  | { kind: "file"; name: string; item: T };

type Folder<T> = Extract<FileNode<T>, { kind: "folder" }>;

/**
 * Range les fichiers en dossiers selon leur chemin. Dossiers avant fichiers, chacun trié par nom ;
 * un dossier qui ne contient qu'un dossier est fusionné avec lui (« src/lib » sur une seule ligne).
 * `files` liste tous les fichiers d'un dossier, sous-dossiers compris.
 */
export function fileTree<T>(items: T[], pathOf: (item: T) => string): FileNode<T>[] {
  const root: Folder<T> = { kind: "folder", name: "", path: "", children: [], files: [] };
  for (const item of items) {
    const parts = pathOf(item).split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.children.find((n): n is Folder<T> => n.kind === "folder" && n.name === part);
      if (!next) {
        next = { kind: "folder", name: part, path, children: [], files: [] };
        folder.children.push(next);
      }
      next.files.push(item);
      folder = next;
    }
    folder.children.push({ kind: "file", name: parts[parts.length - 1], item });
  }
  return finish(root.children);
}

function finish<T>(nodes: FileNode<T>[]): FileNode<T>[] {
  return nodes
    .map((n) => {
      if (n.kind === "file") return n;
      let folder = n;
      while (folder.children.length === 1 && folder.children[0].kind === "folder") {
        const child: Folder<T> = folder.children[0];
        folder = { ...child, name: `${folder.name}/${child.name}` };
      }
      return { ...folder, children: finish(folder.children) };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Fichiers dans l'ordre affiché, sans ceux des dossiers repliés (plages Maj + clic). */
export function visibleFiles<T>(nodes: FileNode<T>[], isOpen: (path: string) => boolean): T[] {
  return nodes.flatMap((n) => {
    if (n.kind === "file") return [n.item];
    return isOpen(n.path) ? visibleFiles(n.children, isOpen) : [];
  });
}
