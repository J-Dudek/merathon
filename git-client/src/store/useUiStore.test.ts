import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clampGraphWidth, clampSideWidth, defaultSideWidths, MAX_TOASTS, MIN_GRAPH_WIDTH, useUiStore } from "./useUiStore";

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

describe("toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const { toasts, dismiss, holdToasts } = useUiStore.getState();
    toasts.forEach((t) => dismiss(t.id));
    holdToasts(false);
  });
  afterEach(() => vi.useRealTimers());

  const messages = () => useUiStore.getState().toasts.map((t) => t.message);

  it("caps the stack, dropping the oldest information before errors", () => {
    const { notify } = useUiStore.getState();
    notify("error", "e1");
    for (let i = 1; i <= MAX_TOASTS + 1; i++) notify("success", `s${i}`);
    expect(messages()).toEqual(["e1", "s3", "s4", "s5", "s6"]);
  });

  it("replaces an identical message instead of stacking it", () => {
    const { notify } = useUiStore.getState();
    notify("success", "Fetch terminé");
    notify("info", "autre");
    vi.advanceTimersByTime(4000);
    notify("success", "Fetch terminé");
    expect(messages()).toEqual(["autre", "Fetch terminé"]);
    vi.advanceTimersByTime(1500);
    expect(messages()).toEqual(["Fetch terminé"]);
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });

  it("does not restart running delays when the hold state does not change", () => {
    const { notify, holdToasts } = useUiStore.getState();
    notify("success", "a");
    vi.advanceTimersByTime(4000);
    holdToasts(false);
    vi.advanceTimersByTime(1000);
    expect(messages()).toEqual([]);
  });
});
