import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, effectiveFilter, filterGraph } from "./graphFilter";
import type { BranchInfo, CommitInfo, RefLabel } from "../types/git";

const local = (name: string): RefLabel => ({ name, kind: "local" });
const commit = (hash: string, parents: string[], refs: RefLabel[] = []) => ({ hash, parents, refs }) as CommitInfo;

// a ← b ← c (main, tag v1) ; b ← d (feature) ; a ← e (old)
const commits = [
  commit("c", ["b"], [local("main"), { name: "v1", kind: "tag" }]),
  commit("d", ["b"], [local("feature"), { name: "origin/feature", kind: "remote" }]),
  commit("e", ["a"], [local("old")]),
  commit("b", ["a"]),
  commit("a", []),
];
const hashes = (list: CommitInfo[]) => list.map((c) => c.hash);

describe("filterGraph", () => {
  it("ne change rien sans filtre", () => {
    expect(filterGraph(commits, EMPTY_FILTER)).toBe(commits);
  });

  it("masque les commits propres à une branche, pas l'historique partagé", () => {
    const result = filterGraph(commits, { hidden: ["local:old"], solo: [] });
    expect(hashes(result)).toEqual(["c", "d", "b", "a"]);
  });

  it("garde les commits d'une branche masquée encore portés par une autre, sans son étiquette", () => {
    const result = filterGraph(commits, { hidden: ["local:feature"], solo: [] });
    expect(hashes(result)).toContain("d"); // origin/feature reste affichée
    expect(result.find((c) => c.hash === "d")!.refs).toEqual([{ name: "origin/feature", kind: "remote" }]);
  });

  it("solo : seule la branche et ses ancêtres, les tags restent visibles sur ses commits", () => {
    const result = filterGraph(commits, { hidden: [], solo: ["local:main"] });
    expect(hashes(result)).toEqual(["c", "b", "a"]);
    expect(result[0].refs).toEqual([local("main"), { name: "v1", kind: "tag" }]);
  });
});

describe("effectiveFilter", () => {
  it("oublie les branches qui n'existent plus", () => {
    const branches = [{ name: "main", is_remote: false }] as BranchInfo[];
    expect(effectiveFilter({ hidden: ["local:gone"], solo: ["local:main"] }, branches)).toEqual({ hidden: [], solo: ["local:main"] });
  });
});
