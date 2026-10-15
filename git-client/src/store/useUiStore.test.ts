import { describe, it, expect, beforeEach } from "vitest";
import { clampGraphWidth, clampSideWidth, defaultSideWidths, MIN_GRAPH_WIDTH, useUiStore } from "./useUiStore";

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
    expect(JSON.parse(localStorage.getItem("merathon.side-widths")!)).toEqual({ left: 180, right: 400 });
  });
});

describe("graph width", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ graphWidth: null });
  });

  it("keeps a minimum of one lane and treats invalid values as no limit", () => {
    expect(clampGraphWidth(120.6)).toBe(121);
    expect(clampGraphWidth(5)).toBe(MIN_GRAPH_WIDTH);
    expect(clampGraphWidth(null)).toBeNull();
    expect(clampGraphWidth("wide")).toBeNull();
    expect(clampGraphWidth(Infinity)).toBeNull();
  });

  it("stores the limit and forgets it when reset", () => {
    useUiStore.getState().setGraphWidth(150);
    expect(useUiStore.getState().graphWidth).toBe(150);
    expect(localStorage.getItem("merathon.graph-width")).toBe("150");

    useUiStore.getState().setGraphWidth(null);
    expect(useUiStore.getState().graphWidth).toBeNull();
    expect(localStorage.getItem("merathon.graph-width")).toBeNull();
  });
});
