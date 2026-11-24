import { describe, it, expect } from "vitest";
import { contextAround, contextLines, type Expansion } from "./diffContext";
import type { DiffHunk } from "../types/git";

const hunk = (newStart: number, count: number): DiffHunk => ({
  header: "",
  old_start: newStart,
  new_start: newStart,
  lines: Array.from({ length: count }, (_, i) => ({ kind: "context" as const, content: "x", old_lineno: newStart + i, new_lineno: newStart + i })),
});
const none: Expansion = { up: 0, down: 0 };

describe("contextAround", () => {
  it("expands above and below within the file", () => {
    const [c] = contextAround([hunk(20, 3)], [{ up: 5, down: 10 }], 100);
    expect(c.above).toEqual({ from: 15, to: 19 });
    expect(c.below).toEqual({ from: 23, to: 32 });
    expect(c.hiddenAbove).toBe(14);
    expect(c.hiddenBelow).toBe(68);
  });

  it("stops at the start and the end of the file", () => {
    const [c] = contextAround([hunk(3, 2)], [{ up: 10, down: 10 }], 8);
    expect(c.above).toEqual({ from: 1, to: 2 });
    expect(c.below).toEqual({ from: 5, to: 8 });
    expect(c.hiddenAbove + c.hiddenBelow).toBe(0);
  });

  it("never shows the same line twice between two hunks", () => {
    const hunks = [hunk(1, 2), hunk(9, 2)];
    const [a, b] = contextAround(hunks, [{ up: 0, down: 5 }, { up: 10, down: 0 }], 20);
    expect(a.below).toEqual({ from: 3, to: 7 });
    expect(b.above).toEqual({ from: 8, to: 8 });
    expect(a.hiddenBelow).toBe(0);
    expect(b.hiddenAbove).toBe(0);
  });

  it("does not know the end of the file before it is loaded", () => {
    const [c] = contextAround([hunk(5, 1)], [none], null);
    expect(c.hiddenBelow).toBe(Infinity);
    expect(c.hiddenAbove).toBe(4);
  });
});

describe("contextLines", () => {
  it("numbers lines in both versions", () => {
    const lines = ["a", "b", "c", "d"];
    expect(contextLines(lines, { from: 2, to: 3 }, 4)).toEqual([
      { kind: "context", content: "b", old_lineno: 6, new_lineno: 2 },
      { kind: "context", content: "c", old_lineno: 7, new_lineno: 3 },
    ]);
    expect(contextLines(lines, null, 0)).toEqual([]);
  });
});
