import { describe, it, expect, beforeEach } from "vitest";
import { loadViewed, saveViewed } from "./viewedFiles";

describe("viewed files", () => {
  beforeEach(() => localStorage.clear());

  it("restores the files viewed for the same head commit", () => {
    saveViewed("acc/o/r/7", "abc", new Set(["a.ts", "b.ts"]));
    expect([...loadViewed("acc/o/r/7", "abc")]).toEqual(["a.ts", "b.ts"]);
  });

  it("resets after a new push", () => {
    saveViewed("acc/o/r/7", "abc", new Set(["a.ts"]));
    expect(loadViewed("acc/o/r/7", "def").size).toBe(0);
  });

  it("ignores corrupted data", () => {
    localStorage.setItem("merathon.viewed.acc/o/r/7", "{oops");
    expect(loadViewed("acc/o/r/7", "abc").size).toBe(0);
  });
});
