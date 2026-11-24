import { describe, it, expect } from "vitest";
import { ageColor, recencyOf } from "./BlameViewer";

const lightness = (color: string) => Number(/ (\d+)% \//.exec(color)![1]);

describe("blame age gradient", () => {
  it("makes recent lines lighter than old ones", () => {
    expect(lightness(ageColor(1))).toBeGreaterThan(lightness(ageColor(0.5)));
    expect(lightness(ageColor(0.5))).toBeGreaterThan(lightness(ageColor(0)));
  });

  it("places a date between the oldest and the newest", () => {
    expect(recencyOf(100, 100, 300)).toBe(0);
    expect(recencyOf(200, 100, 300)).toBe(0.5);
    expect(recencyOf(300, 100, 300)).toBe(1);
    expect(recencyOf(5, 5, 5)).toBe(1);
  });
});
