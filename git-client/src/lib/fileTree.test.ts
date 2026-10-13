import { describe, it, expect } from "vitest";
import { fileTree, visibleFiles, type FileNode } from "./fileTree";

/** Arbre réduit à des chaînes lisibles : « dossier/ (n) » puis ses enfants indentés. */
function render(nodes: FileNode<string>[], indent = ""): string[] {
  return nodes.flatMap((n) =>
    n.kind === "file" ? [`${indent}${n.name}`] : [`${indent}${n.name}/ (${n.files.length})`, ...render(n.children, `${indent}  `)],
  );
}

describe("fileTree", () => {
  it("groups files by folder, folders first, sorted by name", () => {
    const tree = fileTree(["z.txt", "src/b.ts", "a.txt", "src/a.ts", "docs/readme.md"], (p) => p);
    expect(render(tree)).toEqual(["docs/ (1)", "  readme.md", "src/ (2)", "  a.ts", "  b.ts", "a.txt", "z.txt"]);
  });

  it("merges folders that only contain one folder", () => {
    const tree = fileTree(["src/lib/a.ts", "src/lib/deep/b.ts", "src/lib/deep/c.ts"], (p) => p);
    expect(render(tree)).toEqual(["src/lib/ (3)", "  deep/ (2)", "    b.ts", "    c.ts", "  a.ts"]);
    const folder = tree[0];
    expect(folder.kind === "folder" && folder.path).toBe("src/lib");
  });

  it("keeps the full path of every folder", () => {
    const tree = fileTree(["a/b/x.ts", "a/c/y.ts"], (p) => p);
    const a = tree[0];
    expect(a.kind === "folder" && a.children.map((c) => c.kind === "folder" && c.path)).toEqual(["a/b", "a/c"]);
    expect(a.kind === "folder" && a.files).toEqual(["a/b/x.ts", "a/c/y.ts"]);
  });
});

describe("visibleFiles", () => {
  it("lists files in display order, skipping collapsed folders", () => {
    const tree = fileTree(["b.txt", "src/x.ts", "docs/a.md", "a.txt"], (p) => p);
    expect(visibleFiles(tree, () => true)).toEqual(["docs/a.md", "src/x.ts", "a.txt", "b.txt"]);
    expect(visibleFiles(tree, (p) => p !== "src")).toEqual(["docs/a.md", "a.txt", "b.txt"]);
  });
});
