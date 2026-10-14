import { describe, expect, it } from "vitest";
import { ancestorsOf, canFastForward } from "./ancestry";
import type { CommitInfo } from "../types/git";

// a ← b ← c (main) ; b ← d (feature) ; e : merge de c et d
const commit = (hash: string, parents: string[] = []) => ({ hash, parents }) as CommitInfo;
const commits = [commit("e", ["c", "d"]), commit("d", ["b"]), commit("c", ["b"]), commit("b", ["a"]), commit("a")];

describe("ancestorsOf", () => {
  it("remonte tous les parents, merges compris", () => {
    expect([...ancestorsOf(commits, "e")].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect([...ancestorsOf(commits, "d")].sort()).toEqual(["a", "b", "d"]);
    expect(ancestorsOf(commits, null).size).toBe(0);
  });
});

describe("canFastForward", () => {
  it("seulement si HEAD est un ancêtre strict de la cible", () => {
    expect(canFastForward(commits, "b", "d")).toBe(true);
    expect(canFastForward(commits, "c", "d")).toBe(false);
    expect(canFastForward(commits, "d", "d")).toBe(false);
    expect(canFastForward(commits, "d", "b")).toBe(false);
  });
});
