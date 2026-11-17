import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("utilise le presse-papiers du navigateur quand il existe (contexte sécurisé)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("abc");
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("copie par un champ temporaire quand navigator.clipboard est absent (HTTP sur le réseau local)", async () => {
    vi.stubGlobal("navigator", {});
    let copied = "";
    document.execCommand = vi.fn(() => {
      copied = (document.querySelector("textarea") as HTMLTextAreaElement).value;
      return true;
    });
    await copyText("depuis http");
    expect(copied).toBe("depuis http");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("signale l'échec de la copie et ne laisse pas de champ dans la page", async () => {
    vi.stubGlobal("navigator", {});
    document.execCommand = vi.fn(() => false);
    await expect(copyText("x")).rejects.toThrow();
    expect(document.querySelector("textarea")).toBeNull();
  });
});
