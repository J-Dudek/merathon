import { describe, it, expect } from "vitest";
import { PULL_MAX, PULL_THRESHOLD, canStartPull, isHorizontal, pullDistance, shouldRefresh } from "./pullToRefresh";

describe("pull to refresh", () => {
  it("resists and caps the pull", () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(40)).toBe(20);
    expect(pullDistance(10_000)).toBe(PULL_MAX);
  });

  it("refreshes only past the threshold", () => {
    expect(shouldRefresh(PULL_THRESHOLD - 1)).toBe(false);
    expect(shouldRefresh(PULL_THRESHOLD)).toBe(true);
  });

  it("ignores mostly horizontal gestures", () => {
    expect(isHorizontal(30, 10)).toBe(true);
    expect(isHorizontal(5, 30)).toBe(false);
  });

  it("starts only when nothing between the finger and the container is scrolled", () => {
    const container = document.createElement("div");
    const list = document.createElement("div");
    const row = document.createElement("button");
    list.append(row);
    container.append(list);
    document.body.append(container);

    expect(canStartPull(row, container)).toBe(true);
    list.scrollTop = 40;
    expect(canStartPull(row, container)).toBe(false);
    list.scrollTop = 0;

    const field = document.createElement("textarea");
    list.append(field);
    expect(canStartPull(field, container)).toBe(false);
    list.setAttribute("data-no-pull", "");
    expect(canStartPull(row, container)).toBe(false);
    container.remove();
  });
});
