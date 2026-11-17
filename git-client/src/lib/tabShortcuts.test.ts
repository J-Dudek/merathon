import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTabShortcut, keysInText, tabShortcuts } from "./tabShortcuts";

const key = (k: string, mods: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  key: k, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift,
});

describe("raccourcis des onglets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("bureau : Ctrl, et aucune touche Alt interceptée", () => {
    expect(tabShortcuts()).toEqual({ newTab: "Ctrl+T", closeTab: "Ctrl+W", nextTab: "Ctrl+Tab", previousTab: "Ctrl+Maj+Tab", newWindow: "Ctrl+Maj+N" });
    expect(browserTabShortcut(key("t", { alt: true }))).toBeNull();
  });

  it("NAS : Alt, car le navigateur garde Ctrl+T, Ctrl+W, Ctrl+Tab et Ctrl+PgSuiv / PgPréc ; pas de nouvelle fenêtre", () => {
    vi.stubEnv("VITE_TARGET", "server");
    expect(tabShortcuts()).toEqual({ newTab: "Alt+T", closeTab: "Alt+W", nextTab: "Alt+PgSuiv", previousTab: "Alt+PgPréc", newWindow: null });
    expect(browserTabShortcut(key("t", { alt: true }))).toBe("t");
    expect(browserTabShortcut(key("W", { alt: true }))).toBe("w");
    expect(browserTabShortcut(key("PageDown", { alt: true }))).toBe("pagedown");
    expect(browserTabShortcut(key("PageUp", { alt: true }))).toBe("pageup");
    expect(browserTabShortcut(key("N", { alt: true, shift: true }))).toBeNull();
  });

  it("NAS : ni AltGr (Ctrl+Alt sous Windows), ni Option d'un Mac, ni les autres touches", () => {
    vi.stubEnv("VITE_TARGET", "server");
    expect(browserTabShortcut(key("t", { alt: true, ctrl: true }))).toBeNull();
    expect(browserTabShortcut(key("t", { alt: true, meta: true }))).toBeNull();
    expect(browserTabShortcut(key("†", { alt: true }))).toBeNull();
    expect(browserTabShortcut(key("j", { alt: true }))).toBeNull();
    expect(browserTabShortcut(key("n", { alt: true }))).toBeNull();
    expect(browserTabShortcut(key("t"))).toBeNull();
  });

  it("dans une phrase, les noms des touches suivent la langue (français ici)", () => {
    expect(keysInText("Ctrl+Maj+N")).toBe("Ctrl+Maj+N");
    expect(keysInText("Alt+T")).toBe("Alt+T");
  });
});
