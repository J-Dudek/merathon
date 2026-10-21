import { describe, it, expect } from "vitest";
import { stepOutcome } from "./RebaseTimeline";
import type { TimelineStep } from "../types/git";

const step = (patch: Partial<TimelineStep>): TimelineStep => ({
  hash: "a".repeat(40),
  short_hash: "aaaaaaa",
  summary: "c1",
  action: "pick",
  status: "done",
  new_hash: null,
  skipped: false,
  ...patch,
});

describe("stepOutcome", () => {
  it("describes the current step from the stop reason", () => {
    expect(stepOutcome(step({ status: "current" }), "conflict")).toEqual({ label: "conflit", detail: "à résoudre" });
    expect(stepOutcome(step({ status: "current", action: "edit" }), "edit")?.label).toBe("à modifier");
  });

  it("says nothing about steps still to do", () => {
    expect(stepOutcome(step({ status: "todo" }), "conflict")).toBeNull();
  });

  it("describes what happened to done steps", () => {
    const label = (s: Partial<TimelineStep>) => stepOutcome(step(s), "conflict")?.label;
    expect(label({ action: "drop" })).toBe("supprimé");
    expect(label({ skipped: true })).toBe("sauté");
    expect(label({ action: "fixup", new_hash: "b".repeat(40) })).toBe("fusionné");
    expect(label({ new_hash: "a".repeat(40) })).toBe("inchangé");
    expect(label({ action: "reword", new_hash: "b".repeat(40) })).toBe("→ bbbbbbb");
  });
});
