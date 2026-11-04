import { describe, it, expect } from "vitest";
// @ts-expect-error module JavaScript sans déclarations de types
import { findIssues, parseCatalog, scanSource } from "./check-i18n.mjs";

describe("traductions du projet", () => {
  it("n'a aucun problème", () => {
    expect(findIssues()).toEqual([]);
  });
});

describe("scanSource", () => {
  it("collects the texts of tr and both forms of trn", () => {
    const { keys, hardcoded } = scanSource("a.ts", `tr("Fermer"); trn(n, "{n} fichier", "{n} fichiers", { x: 1 });`);
    expect(keys).toEqual(["Fermer", "{n} fichier", "{n} fichiers"]);
    expect(hardcoded).toEqual([]);
  });

  it("reports French written outside tr", () => {
    const text = (source: string, path = "a.tsx") => scanSource(path, source).hardcoded.map((h: { text: string }) => h.text);
    expect(text(`const a = <p>Fermer la fenêtre</p>;`)).toEqual(["Fermer la fenêtre"]);
    expect(text(`const a = <input placeholder="Rechercher" />;`)).toEqual(["Rechercher"]);
    expect(text("notify(`Dépôt ${name} ouvert`);")).toEqual(["Dépôt"]);
    expect(text(`notify("Choisis un dossier");`)).toEqual(["Choisis un dossier"]);
  });

  it("reports French inside the parameters of tr", () => {
    expect(scanSource("a.ts", `tr("{x} ok", { x: "à faire" })`).hardcoded.map((h: { text: string }) => h.text)).toEqual(["à faire"]);
  });

  it("ignores code, console messages and allowed terms", () => {
    const source = `import a from "./é"; type T = "é"; console.warn("Échec du chargement"); const b = <div className="flex items-center" title="Merathon">{x}</div>; const c = "é".length === 1 ? { "clé": 1 } : 0;`;
    expect(scanSource("a.tsx", source).hardcoded.map((h: { text: string }) => h.text)).toEqual(["é"]);
  });
});

describe("parseCatalog", () => {
  it("reads the translations without running the file", () => {
    expect(parseCatalog(`export const en: Record<string, string> = { "Fermer": "Close", "a\\nb": "c" };`)).toEqual(new Map([["Fermer", "Close"], ["a\nb", "c"]]));
  });
});
