import { describe, expect, it } from "vitest";
import { filterMemo, GIT_MEMO } from "./gitMemo";

const titles = (query: string) => filterMemo(GIT_MEMO, query).flatMap((g) => g.entries.map((e) => e.title));

describe("GIT_MEMO", () => {
  it("décrit chaque opération avec un cas d'usage et une marche à suivre", () => {
    for (const entry of GIT_MEMO.flatMap((g) => g.entries)) {
      expect(entry.example, entry.title).not.toBe("");
      expect(entry.steps.length, entry.title).toBeGreaterThan(0);
    }
  });

  it("n'a pas de titre ni de rubrique en double", () => {
    const all = GIT_MEMO.flatMap((g) => g.entries.map((e) => e.title));
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(GIT_MEMO.map((g) => g.id)).size).toBe(GIT_MEMO.length);
  });
});

describe("filterMemo", () => {
  it("rend tout le mémo sans recherche", () => {
    expect(filterMemo(GIT_MEMO, "  ")).toBe(GIT_MEMO);
  });

  it("cherche dans les commandes, sans tenir compte de la casse ni des accents", () => {
    expect(titles("cherry-pick")).toEqual(["Reprendre un commit d'une autre branche"]);
    expect(titles("DESINDEXER")).toContain("Désindexer");
  });

  it("exige tous les mots et retire les rubriques vides", () => {
    expect(titles("push force")).toContain("Forcer un push");
    expect(filterMemo(GIT_MEMO, "zzz introuvable")).toEqual([]);
  });
});
