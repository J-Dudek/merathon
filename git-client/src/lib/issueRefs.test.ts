import { describe, expect, it } from "vitest";
import { addClosingRef, closesIssue, insertIssueRef, issueNumberFromBranch, issueQueryAt, matchIssues, uniqueIssues } from "./issueRefs";
import type { ForgeIssue } from "../types/forge";

const issue = (number: number, title: string): ForgeIssue => ({ number, title, state: "open", author: "", url: "", createdAt: "", labels: [] });

describe("issueQueryAt", () => {
  it("détecte un « # » en début de mot juste avant le curseur", () => {
    expect(issueQueryAt("#", 1)).toEqual({ start: 0, query: "" });
    expect(issueQueryAt("voir #12", 8)).toEqual({ start: 5, query: "12" });
    expect(issueQueryAt("ligne\n(#cra", 11)).toEqual({ start: 7, query: "cra" });
  });

  it("lit seulement jusqu'au curseur", () => {
    expect(issueQueryAt("voir #123 ensuite", 7)).toEqual({ start: 5, query: "1" });
  });

  it("ignore un « # » collé à un mot, un titre Markdown et une saisie terminée", () => {
    expect(issueQueryAt("a#1", 3)).toBeNull();
    expect(issueQueryAt("## Titre", 2)).toBeNull();
    expect(issueQueryAt("# Titre", 2)).toBeNull();
    expect(issueQueryAt("#12 ", 4)).toBeNull();
  });
});

describe("matchIssues", () => {
  const issues = [issue(120, "Crash au démarrage"), issue(12, "Écran blanc"), issue(3, "Menu 12 colonnes")];

  it("filtre par début de numéro ou par titre, sans casse ni accents, numéro exact en tête", () => {
    expect(matchIssues(issues, "12").map((i) => i.number)).toEqual([12, 120, 3]);
    expect(matchIssues(issues, "ecran").map((i) => i.number)).toEqual([12]);
    expect(matchIssues(issues, "DEMARR").map((i) => i.number)).toEqual([120]);
  });

  it("propose tout, dans l'ordre, sans saisie, dans la limite donnée", () => {
    expect(matchIssues(issues, "", 2).map((i) => i.number)).toEqual([120, 12]);
  });

  it("dédoublonne par numéro", () => {
    expect(uniqueIssues([issue(1, "a"), issue(2, "b"), issue(1, "c")]).map((i) => i.title)).toEqual(["a", "b"]);
  });
});

describe("insertIssueRef", () => {
  it("remplace la saisie par la référence suivie d'une espace", () => {
    expect(insertIssueRef("voir #cr", { start: 5, query: "cr" }, 8, 42)).toEqual({ text: "voir #42 ", caret: 9 });
  });

  it("n'ajoute pas d'espace devant un blanc existant et garde la suite", () => {
    expect(insertIssueRef("voir #1\nfin", { start: 5, query: "1" }, 7, 12)).toEqual({ text: "voir #12\nfin", caret: 8 });
  });

  it("insère le mot-clé de fermeture", () => {
    expect(insertIssueRef("#", { start: 0, query: "" }, 1, 7, true)).toEqual({ text: "Closes #7 ", caret: 10 });
  });
});

describe("fermeture au merge", () => {
  it("reconnaît les mots-clés de GitHub et GitLab, pas un autre numéro", () => {
    expect(closesIssue("Closes #12", 12)).toBe(true);
    expect(closesIssue("fixes: #12.", 12)).toBe(true);
    expect(closesIssue("Resolved #12", 12)).toBe(true);
    expect(closesIssue("Closes #123", 12)).toBe(false);
    expect(closesIssue("voir #12", 12)).toBe(false);
  });

  it("ajoute « Closes #N » en fin de description, une seule fois", () => {
    expect(addClosingRef("", 5)).toBe("Closes #5\n");
    expect(addClosingRef("## Contexte\nTexte\n\n", 5)).toBe("## Contexte\nTexte\n\nCloses #5\n");
    expect(addClosingRef("Fixes #5", 5)).toBe("Fixes #5");
  });
});

describe("issueNumberFromBranch", () => {
  it("lit le numéro en tête du dernier segment ou après issue/gh", () => {
    expect(issueNumberFromBranch("feat/123-login")).toBe(123);
    expect(issueNumberFromBranch("45_fix")).toBe(45);
    expect(issueNumberFromBranch("fix/issue-42")).toBe(42);
    expect(issueNumberFromBranch("fix/login-gh7")).toBe(7);
    expect(issueNumberFromBranch("feat/99")).toBe(99);
  });

  it("ignore les branches sans numéro d'issue", () => {
    expect(issueNumberFromBranch("feat/interactive_rebase")).toBeNull();
    expect(issueNumberFromBranch("release/2.8.0")).toBeNull();
    expect(issueNumberFromBranch("feat/v2-ui")).toBeNull();
  });
});
