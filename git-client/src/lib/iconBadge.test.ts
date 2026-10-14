import { describe, expect, it } from "vitest";
import { pendingCount } from "./iconBadge";
import { seenKey, type SeenPr } from "../store/useSeenPrsStore";
import type { PrSummary } from "../types/forge";

const pr = (number: number, updatedAt = "2026-01-02") => ({ number, projectPath: "group/app", headSha: "h", updatedAt }) as PrSummary;
const seenAt = (updatedAt: string): SeenPr => ({ head: "h", updatedAt, at: 0 });

describe("pendingCount", () => {
  it("compte les PR modifiées depuis leur consultation et celles à traiter jamais ouvertes", () => {
    const seen = {
      [seenKey("a", "group/app", 1)]: seenAt("2026-01-01"), // modifiée depuis
      [seenKey("a", "group/app", 2)]: seenAt("2026-01-02"), // lue, inchangée
    };
    const data = { assigned: [pr(1), pr(2), pr(3)], authored: [pr(1), pr(4)] };
    // 1 : modifiée (comptée une fois), 3 : à traiter jamais ouverte ; 4 : la mienne, jamais consultée → ignorée.
    expect(pendingCount([{ accountId: "a", data }], seen)).toBe(2);
  });

  it("distingue les comptes", () => {
    const data = { assigned: [pr(1)], authored: [] };
    expect(pendingCount([{ accountId: "a", data }, { accountId: "b", data }], {})).toBe(2);
  });
});
