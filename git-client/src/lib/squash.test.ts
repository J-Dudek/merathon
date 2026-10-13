import { describe, it, expect } from "vitest";
import { squashPlan, type SquashPlan } from "./squash";
import type { TodoCommit } from "../types/git";

const commit = (hash: string, parents: string[]): TodoCommit => ({
  hash, short_hash: hash, summary: hash, message: hash, author: "T", timestamp: 0, parents, is_merge: parents.length > 1,
});

// base ← a ← b ← c ← d (du plus ancien au plus récent)
const linear = [commit("a", ["base"]), commit("b", ["a"]), commit("c", ["b"]), commit("d", ["c"])];

const actions = (plan: SquashPlan | string) => (plan as SquashPlan).steps.map((s) => `${s.action} ${s.hash}`);

describe("squashPlan", () => {
  it("squashes adjacent commits into the oldest", () => {
    const plan = squashPlan(linear, ["c", "b"], "b + c") as SquashPlan;
    expect(plan.mode).toBe("linear");
    expect(actions(plan)).toEqual(["pick a", "pick b", "squash c", "pick d"]);
    expect(plan.steps[2].message).toBe("b + c");
  });

  it("groups non-adjacent commits behind the oldest one", () => {
    const plan = squashPlan(linear, ["d", "a"], "");
    expect(actions(plan)).toEqual(["pick a", "squash d", "pick b", "pick c"]);
    expect((plan as SquashPlan).steps[1].message).toBeNull();
  });

  it("puts the final message on the last squash only", () => {
    const plan = squashPlan(linear, ["a", "b", "c"], "all") as SquashPlan;
    expect(plan.steps.map((s) => s.message)).toEqual([null, null, "all", null]);
  });

  it("rejects invalid selections", () => {
    expect(squashPlan(linear, ["a"], "")).toMatch(/deux commits/);
    expect(squashPlan(linear, ["a", "elsewhere"], "")).toMatch(/branche courante/);
  });

  it("keeps merges and requires adjacent commits when history has merges", () => {
    // a ← b ← m (merge de x) ← c
    const todo = [commit("a", ["base"]), commit("x", ["base"]), commit("b", ["a"]), commit("m", ["b", "x"]), commit("c", ["m"])];
    expect(squashPlan(todo, ["m", "c"], "")).toMatch(/merge ne peut pas/);
    expect(squashPlan(todo, ["a", "c"], "")).toMatch(/se suivre/);
    const plan = squashPlan(todo, ["a", "b"], "") as SquashPlan;
    expect(plan.mode).toBe("preserve");
    expect(actions(plan)).toEqual(["pick a", "pick x", "squash b", "pick m", "pick c"]);
  });
});
