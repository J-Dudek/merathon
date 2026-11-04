import { describe, expect, it } from "vitest";
import { resolveLanguage, translate, translatePlural } from "./index";

describe("resolveLanguage", () => {
  it("uses the chosen language, French by default", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("fr")).toBe("fr");
    expect(resolveLanguage(undefined)).toBe("fr");
    expect(resolveLanguage("de")).toBe("fr");
  });
});

describe("translate", () => {
  it("returns the French source, and its English translation", () => {
    expect(translate("fr", "Fermer")).toBe("Fermer");
    expect(translate("en", "Fermer")).toBe("Close");
  });

  it("fills in the parameters", () => {
    expect(translate("en", "Branche {name} créée", { name: "main" })).toBe("Branch main created");
  });
});

describe("translatePlural", () => {
  it("applies the plural rule of each language to zero", () => {
    expect(translatePlural("fr", 0, "{n} fichier", "{n} fichiers")).toBe("0 fichier");
    expect(translatePlural("en", 0, "{n} fichier", "{n} fichiers")).toBe("0 files");
    expect(translatePlural("en", 1, "{n} fichier", "{n} fichiers")).toBe("1 file");
  });
});
