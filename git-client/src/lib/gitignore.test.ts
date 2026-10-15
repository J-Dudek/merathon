import { describe, expect, it } from "vitest";
import { ignoreDirPattern, ignoreExtensionPattern, ignoreFilePattern, ignoreFolderPattern } from "./gitignore";

describe("ignoreFilePattern", () => {
  it("ancre le chemin à la racine du dépôt", () => {
    expect(ignoreFilePattern("src/debug.log")).toBe("/src/debug.log");
  });

  it("échappe les caractères spéciaux", () => {
    expect(ignoreFilePattern("a[1]*.txt")).toBe("/a\\[1\\]\\*.txt");
    expect(ignoreFilePattern("fin ")).toBe("/fin\\ ");
  });
});

describe("ignoreDirPattern", () => {
  it("ancre le dossier à la racine du dépôt", () => {
    expect(ignoreDirPattern("build/out")).toBe("/build/out/");
  });

  it("échappe les caractères spéciaux", () => {
    expect(ignoreDirPattern("tmp[1]")).toBe("/tmp\\[1\\]/");
  });
});

describe("ignoreFolderPattern", () => {
  it("désigne le dossier parent", () => {
    expect(ignoreFolderPattern("build/out/app.js")).toBe("/build/out/");
  });

  it("vaut null à la racine", () => {
    expect(ignoreFolderPattern("app.js")).toBeNull();
  });
});

describe("ignoreExtensionPattern", () => {
  it("désigne tous les fichiers de l'extension", () => {
    expect(ignoreExtensionPattern("logs/debug.log")).toBe("*.log");
    expect(ignoreExtensionPattern("a.tar.gz")).toBe("*.gz");
  });

  it("vaut null sans extension ou pour un fichier caché", () => {
    expect(ignoreExtensionPattern("Makefile")).toBeNull();
    expect(ignoreExtensionPattern("conf/.env")).toBeNull();
  });
});
