import { describe, it, expect } from "vitest";
import { defaultDisplay, sanitize, stepZoom } from "./useDisplayStore";

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
      zoom: 1.25, terminalFontSize: 14, density: "compact", syncInterval: 0, theme: "light",
    });
    expect(sanitize({ zoom: 9, terminalFontSize: 100, density: "énorme", syncInterval: 7, theme: "rose" })).toEqual({
      ...defaultDisplay, terminalFontSize: 24,
    });
    expect(sanitize(null)).toEqual(defaultDisplay);
  });
});
