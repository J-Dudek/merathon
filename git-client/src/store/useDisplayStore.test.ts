import { describe, it, expect } from "vitest";
import { defaultDisplay, defaultNotifications, sanitize, stepZoom } from "./useDisplayStore";

describe("stepZoom", () => {
  it("moves to the next or previous step, within bounds", () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.1);
    expect(stepZoom(1, -1)).toBeCloseTo(0.9);
    expect(stepZoom(1.2, 1)).toBe(1.25);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.8, -1)).toBeCloseTo(0.8);
  });
});

describe("sanitize", () => {
  it("keeps valid settings and repairs invalid ones", () => {
    expect(sanitize({ zoom: 1.25, terminalFontSize: 14, density: "compact", syncInterval: 0, theme: "light" })).toEqual({
      zoom: 1.25, terminalFontSize: 14, density: "compact", syncInterval: 0, theme: "light", language: "fr", languageChosen: false, notifications: defaultNotifications,
    });
    expect(sanitize({ zoom: 9, terminalFontSize: 100, density: "énorme", syncInterval: 7, theme: "rose" })).toEqual({
      ...defaultDisplay, terminalFontSize: 24,
    });
    expect(sanitize(null)).toEqual(defaultDisplay);
  });

  it("keeps a supported language and ignores any other", () => {
    expect(sanitize({ language: "en" }).language).toBe("en");
    expect(sanitize({ language: "de" }).language).toBe("fr");
  });

  it("asks for the language when settings saved by an older version have no choice", () => {
    expect(sanitize({ zoom: 1.25, theme: "dark" }).languageChosen).toBe(false);
    expect(sanitize({ language: "en", languageChosen: true })).toMatchObject({ language: "en", languageChosen: true });
  });

  it("complète les réglages de notification incomplets ou invalides", () => {
    expect(sanitize({ notifications: { enabled: false, ci: "oui" } }).notifications).toEqual({ ...defaultNotifications, enabled: false });
  });
});
