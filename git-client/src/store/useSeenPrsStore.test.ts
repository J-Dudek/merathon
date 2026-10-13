import { beforeEach, describe, expect, it } from "vitest";
import { prFreshness, useSeenPrsStore } from "./useSeenPrsStore";
import type { ForgePR } from "../types/forge";

const pr = (updatedAt: string, headSha = "h", commentCount?: number) => ({ number: 1, updatedAt, headSha, commentCount }) as ForgePR;
const seen = { head: "h", updatedAt: "2026-01-01", comments: 2, at: 0 };

describe("prFreshness", () => {
  it("distingue non lue, lue et modifiée", () => {
    expect(prFreshness(undefined, pr("2026-01-01"))).toEqual({ kind: "unread" });
    expect(prFreshness(seen, pr("2026-01-01"))).toEqual({ kind: "read" });
    // Liste en cache plus ancienne que la consultation : lue.
    expect(prFreshness(seen, pr("2025-12-31", "old"))).toEqual({ kind: "read" });
    expect(prFreshness(seen, pr("2026-01-02", "h2", 2))).toEqual({ kind: "updated", commits: true, comments: false });
    expect(prFreshness(seen, pr("2026-01-02", "h", 3))).toEqual({ kind: "updated", commits: false, comments: true });
    expect(prFreshness(seen, pr("2026-01-02"))).toEqual({ kind: "updated", commits: false, comments: false });
  });
});

describe("useSeenPrsStore", () => {
  beforeEach(() => useSeenPrsStore.setState({ seen: {} }));

  it("mémorise une consultation sans revenir à un état plus ancien", () => {
    const { markSeen, markUnread } = useSeenPrsStore.getState();
    markSeen("k", pr("2026-01-02", "h2"));
    markSeen("k", pr("2026-01-01", "h1"));
    expect(useSeenPrsStore.getState().seen.k).toMatchObject({ head: "h2", updatedAt: "2026-01-02" });
    markUnread("k");
    expect(useSeenPrsStore.getState().seen.k).toBeUndefined();
  });

  it("oublie les PR du projet qui ne sont plus ouvertes, pas celles des autres projets", () => {
    const entry = { head: "h", updatedAt: "1", at: 0 };
    useSeenPrsStore.setState({ seen: { "a|o/r#1": entry, "a|o/r#2": entry, "a|o/r2#3": entry, "b|o/r#4": entry } });
    useSeenPrsStore.getState().forgetClosed("a", "o/r", [2]);
    expect(Object.keys(useSeenPrsStore.getState().seen)).toEqual(["a|o/r#2", "a|o/r2#3", "b|o/r#4"]);
  });
});
