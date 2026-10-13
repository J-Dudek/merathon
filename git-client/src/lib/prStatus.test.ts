import { describe, expect, it } from "vitest";
import { groupByProject, myPrStatus, sortByStatus } from "./prStatus";
import type { PrSummary } from "../types/forge";

const pr = (extra: Partial<PrSummary> = {}) =>
  ({ number: 1, projectPath: "o/r", draft: false, conflicts: false, review: "pending", ci: null, updatedAt: "1", ...extra }) as PrSummary;

describe("myPrStatus", () => {
  it("donne d'abord ce qui bloque le merge", () => {
    expect(myPrStatus(pr({ draft: true, conflicts: true }))).toBe("draft");
    expect(myPrStatus(pr({ conflicts: true, review: "approved" }))).toBe("conflicts");
    expect(myPrStatus(pr({ review: "changes_requested", ci: "failure" }))).toBe("changes_requested");
    expect(myPrStatus(pr({ review: "approved", ci: "failure" }))).toBe("ci_failed");
    expect(myPrStatus(pr({ review: "approved", ci: "pending" }))).toBe("approved");
    expect(myPrStatus(pr())).toBe("review_pending");
  });
});

describe("sortByStatus / groupByProject", () => {
  it("trie par état puis activité, et regroupe par projet", () => {
    const a = pr({ number: 1, review: "approved", updatedAt: "3" });
    const b = pr({ number: 2, conflicts: true, projectPath: "a/b" });
    const c = pr({ number: 3, review: "approved", updatedAt: "5" });
    expect(sortByStatus([a, b, c]).map((p) => p.number)).toEqual([2, 3, 1]);
    expect(groupByProject([a, b, c]).map(([p, prs]) => [p, prs.length])).toEqual([["a/b", 1], ["o/r", 2]]);
  });
});
