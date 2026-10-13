import { describe, it, expect } from "vitest";
import { branchOnRemote, branchTree, flattenTree, localOnlyBranches, pullRequestsByBranch, pullRequestTitle } from "./branches";
import type { BranchInfo } from "../types/git";

const branch = (name: string, extra: Partial<BranchInfo> = {}): BranchInfo => ({
  name, is_remote: false, target_hash: "0", is_head: false, upstream: null, ahead: 0, behind: 0, ...extra,
});

describe("localOnlyBranches", () => {
  it("keeps only branches absent from every remote", () => {
    const result = localOnlyBranches([
      branch("main", { upstream: "origin/main" }),
      branch("feat/x"), // pas suivie, mais présente sur origin
      branch("essai"),
      branch("origin/main", { is_remote: true }),
      branch("origin/feat/x", { is_remote: true }),
    ]);
    expect([...result]).toEqual(["essai"]);
  });
});

describe("branchTree", () => {
  it("groups branches into folders by slash", () => {
    const tree = branchTree(["feat/design", "feat/test", "fix/login", "fix/ui/menu", "main"], (n) => n);
    expect(tree.map((n) => [n.kind, n.name])).toEqual([["folder", "feat"], ["folder", "fix"], ["branch", "main"]]);
    const fix = tree[1];
    expect(fix.kind === "folder" && fix.count).toBe(2);
    expect(fix.kind === "folder" && fix.children.map((n) => n.name)).toEqual(["login", "ui"]);
    const ui = fix.kind === "folder" ? fix.children[1] : null;
    expect(ui?.kind === "folder" && ui.path).toBe("fix/ui");
    expect(flattenTree(tree)).toEqual(["feat/design", "feat/test", "fix/login", "fix/ui/menu", "main"]);
  });
});

describe("pullRequestTitle", () => {
  it("turns the branch prefix into a conventional type", () => {
    expect(pullRequestTitle("feat/login-page")).toBe("feat: login page");
    expect(pullRequestTitle("fix/ui/menu_overflow")).toBe("fix: menu overflow");
    expect(pullRequestTitle("hotfix")).toBe("hotfix");
  });
});

describe("branchOnRemote", () => {
  it("uses the tracked branch on the forge remote", () => {
    expect(branchOnRemote(branch("local-name", { upstream: "origin/feat/x" }), "origin")).toBe("feat/x");
    expect(branchOnRemote(branch("feat/x", { upstream: "fork/feat/x" }), "origin")).toBeNull();
  });

  it("falls back to the local name without upstream", () => {
    expect(branchOnRemote(branch("feat/y"), "origin")).toBe("feat/y");
  });

  it("strips the remote prefix of remote branches", () => {
    expect(branchOnRemote(branch("origin/feat/z", { is_remote: true }), "origin")).toBe("feat/z");
    expect(branchOnRemote(branch("upstream/feat/z", { is_remote: true }), "origin")).toBeNull();
  });
});

describe("pullRequestsByBranch", () => {
  it("groups pull requests by source branch", () => {
    const map = pullRequestsByBranch([
      { number: 1, sourceBranch: "a" }, { number: 2, sourceBranch: "b" }, { number: 3, sourceBranch: "a" },
    ]);
    expect(map.get("a")?.map((p) => p.number)).toEqual([1, 3]);
    expect(map.get("b")?.map((p) => p.number)).toEqual([2]);
  });
});
