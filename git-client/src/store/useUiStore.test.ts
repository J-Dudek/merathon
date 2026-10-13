import { describe, it, expect, beforeEach } from "vitest";
import { clampSideWidth, defaultSideWidths, useUiStore } from "./useUiStore";

describe("side panel widths", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sideWidths: defaultSideWidths });
  });

  it("clamps widths to the limits of each panel and repairs invalid values", () => {
    expect(clampSideWidth("left", 300.4)).toBe(300);
    expect(clampSideWidth("left", 10)).toBe(180);
    expect(clampSideWidth("right", 5000)).toBe(800);
    expect(clampSideWidth("right", "large")).toBe(320);
    expect(clampSideWidth("left", NaN)).toBe(240);
  });

  it("stores a resized panel without touching the other one", () => {
    useUiStore.getState().setSideWidth("left", 50);
    useUiStore.getState().setSideWidth("right", 400);

    expect(useUiStore.getState().sideWidths).toEqual({ left: 180, right: 400 });
    expect(JSON.parse(localStorage.getItem("git-client.side-widths")!)).toEqual({ left: 180, right: 400 });
  });
});
