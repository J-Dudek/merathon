import { describe, it, expect } from "vitest";
import { filterCommits } from "./filterCommits";
import type { CommitInfo } from "../types/git";

function c(overrides: Partial<CommitInfo>): CommitInfo {
  return {
    hash: "abcdef1234567890",
    short_hash: "abcdef1",
    message: "fix: something",
    author: "Alice",
    email: "alice@example.com",
    timestamp: 0,
    parents: [],
    refs: [],
    ...overrides,
  };
}

describe("filterCommits", () => {
  it("empty query returns all commits", () => {
    const commits = [c({}), c({ hash: "bbbbbb" })];
    expect(filterCommits(commits, "")).toHaveLength(2);
  });

  it("whitespace-only query returns all commits", () => {
    const commits = [c({}), c({})];
    expect(filterCommits(commits, "   ")).toHaveLength(2);
  });

  it("filters by message (case-insensitive)", () => {
    const commits = [c({ message: "feat: add login" }), c({ message: "chore: cleanup" })];
    expect(filterCommits(commits, "LOGIN")).toHaveLength(1);
  });

  it("filters by author", () => {
    const commits = [c({ author: "Alice" }), c({ author: "Bob" })];
    expect(filterCommits(commits, "bob")).toHaveLength(1);
  });

  it("filters by email", () => {
    const commits = [c({ email: "alice@corp.com" }), c({ email: "bob@corp.com" })];
    expect(filterCommits(commits, "alice@")).toHaveLength(1);
  });

  it("filters by short hash prefix", () => {
    const commits = [
      c({ hash: "111111aaaa", short_hash: "abc1234" }),
      c({ hash: "222222bbbb", short_hash: "def5678" }),
    ];
    expect(filterCommits(commits, "abc")).toHaveLength(1);
  });

  it("filters by full hash prefix", () => {
    const commits = [
      c({ hash: "abcdef1234567890", short_hash: "abcdef1" }),
      c({ hash: "fedcba0987654321", short_hash: "fedcba0" }),
    ];
    expect(filterCommits(commits, "abcdef12")).toHaveLength(1);
  });

  it("filters by ref name", () => {
    const commits = [c({ refs: [{ name: "main", kind: "head" }] }), c({ refs: [{ name: "feature/login", kind: "local" }] })];
    expect(filterCommits(commits, "feature")).toHaveLength(1);
  });

  it("returns empty when no match", () => {
    const commits = [c({ message: "fix: bug" }), c({ message: "chore: lint" })];
    expect(filterCommits(commits, "zzzzzz")).toHaveLength(0);
  });
});
