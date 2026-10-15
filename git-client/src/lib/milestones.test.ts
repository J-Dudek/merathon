import { describe, expect, it } from "vitest";
import {
  EFFECTS, SURPRISE_CHANCE, emptyMilestones, isMilestone, milestoneForCommand, milestoneReason, milestoneTier, milestonesUpTo, nextMilestone, pickEffect, recordEvent,
  sanitizeMilestones,
  type MilestoneState,
} from "./milestones";

/** Tirage fixe : jamais de surprise (au-dessus de SURPRISE_CHANCE), premier élément des listes… sauf pour 0.5. */
const never = () => 0.5;

const withCount = (kind: keyof MilestoneState["counts"], n: number): MilestoneState => ({
  ...emptyMilestones(), counts: { ...emptyMilestones().counts, [kind]: n },
});

describe("isMilestone", () => {
  it("reconnaît les paliers explicites puis les paliers réguliers au-delà", () => {
    expect([9, 10, 11, 25, 1000, 1500, 2000, 1499].map((n) => isMilestone("commit", n))).toEqual([
      false, true, false, true, true, true, true, false,
    ]);
    expect(isMilestone("branch", 1)).toBe(true);
    expect(isMilestone("pr", 150)).toBe(true);
    expect(isMilestone("merge", 1)).toBe(false);
  });
});

describe("recordEvent", () => {
  it("compte sans célébrer entre deux paliers", () => {
    const { state, celebration } = recordEvent(withCount("commit", 3), "commit", never);
    expect(state.counts.commit).toBe(4);
    expect(state.rewards).toEqual([]);
    expect(celebration).toBeNull();
  });

  it("célèbre le 10ᵉ commit en expliquant pourquoi", () => {
    const { state, celebration } = recordEvent(withCount("commit", 9), "commit", never);
    expect(celebration).toMatchObject({
      kind: "commit", count: 10, surprise: false,
      reason: "Vous venez de faire votre 10ᵉ commit avec Merathon.",
      next: "Prochain palier : 25 commits", nextCount: 25, tier: 0,
    });
    expect(celebration!.title).toContain("10");
    expect(state.lastEffect).toBe(celebration!.effect);
    expect(recordEvent(withCount("commit", 9), "commit", never, 1234).state.rewards).toEqual([
      { kind: "commit", count: 10, at: 1234, surprise: false },
    ]);
  });

  it("a un titre à part pour la première branche ou PR", () => {
    expect(recordEvent(emptyMilestones(), "branch", never).celebration!.title).toBe("Première branche créée !");
    expect(recordEvent(emptyMilestones(), "pr", never).celebration!.title).toBe("Première PR / MR ouverte !");
  });

  it("ne rejoue jamais deux fois de suite la même animation", () => {
    for (const last of EFFECTS) {
      for (const r of [0, 0.3, 0.6, 0.99]) expect(pickEffect(last, () => r)).not.toBe(last);
    }
  });

  it("peut faire une surprise sur un commit hors palier", () => {
    const { celebration } = recordEvent(withCount("commit", 3), "commit", () => SURPRISE_CHANCE / 2);
    expect(celebration).toMatchObject({ count: 4, surprise: true });
    expect(celebration!.reason).toContain("1 chance sur 100");
    expect(recordEvent(withCount("branch", 3), "branch", () => 0).celebration).toBeNull();
  });
});

describe("milestoneReason", () => {
  it("accorde l'ordinal de la première fois", () => {
    expect(milestoneReason("branch", 1)).toBe("Vous venez de créer votre 1re branche avec Merathon.");
    expect(milestoneReason("pr", 5)).toBe("Vous venez d'ouvrir votre 5ᵉ PR / MR avec Merathon.");
    expect(milestoneReason("merge", 10)).toBe("Vous venez de réussir votre 10ᵉ fusion avec Merathon.");
  });
});

describe("milestoneTier", () => {
  it("grandit avec les gros paliers", () => {
    expect([10, 100, 999, 1000].map((n) => milestoneTier("commit", n))).toEqual([0, 1, 1, 2]);
    expect([5, 25, 100].map((n) => milestoneTier("pr", n))).toEqual([0, 1, 2]);
  });

  it("reste discret pour une surprise", () => {
    expect(recordEvent(withCount("commit", 1200), "commit", () => SURPRISE_CHANCE / 2).celebration!.tier).toBe(0);
  });
});

describe("milestonesUpTo", () => {
  it("liste les paliers atteints", () => {
    expect(milestonesUpTo("commit", 9)).toEqual([]);
    expect(milestonesUpTo("commit", 60)).toEqual([10, 25, 50]);
    expect(milestonesUpTo("branch", 5)).toEqual([1, 5]);
  });
});

describe("nextMilestone", () => {
  it("donne le palier suivant, y compris au-delà de la liste", () => {
    expect(nextMilestone("commit", 10)).toBe(25);
    expect(nextMilestone("commit", 1000)).toBe(1500);
    expect(nextMilestone("commit", 1700)).toBe(2000);
    expect(nextMilestone("branch", 0)).toBe(1);
  });
});

describe("sanitizeMilestones", () => {
  it("remet à zéro les compteurs invalides", () => {
    expect(sanitizeMilestones({ counts: { commit: 3, branch: -1, pr: "3" }, lastEffect: "laser", seenAt: "hier" })).toEqual({
      counts: { commit: 3, branch: 0, pr: 0, merge: 0 }, lastEffect: null, rewards: [], seenAt: 0,
    });
    expect(sanitizeMilestones(null)).toEqual(emptyMilestones());
  });

  it("garde les récompenses valides et reconstitue, sans date, les paliers déjà atteints", () => {
    const rewards = [
      { kind: "commit", count: 10, at: 1000, surprise: false },
      { kind: "commit", count: 13, at: 2000, surprise: true },
      { kind: "laser", count: 5, at: 3000 },
    ];
    expect(sanitizeMilestones({ counts: { commit: 30, branch: 1 }, rewards }).rewards).toEqual([
      { kind: "commit", count: 25, at: null, surprise: false },
      { kind: "branch", count: 1, at: null, surprise: false },
      { kind: "commit", count: 10, at: 1000, surprise: false },
      { kind: "commit", count: 13, at: 2000, surprise: true },
    ]);
  });
});

describe("milestoneForCommand", () => {
  it("associe les commandes du backend aux types d'action", () => {
    expect(milestoneForCommand("create_commit", { amend: false })).toBe("commit");
    expect(milestoneForCommand("create_commit", { amend: true })).toBeNull();
    expect(milestoneForCommand("create_branch", {})).toBe("branch");
    expect(milestoneForCommand("fast_forward", {})).toBe("merge");
    expect(milestoneForCommand("push", {})).toBeNull();
  });
});
