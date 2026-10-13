import { describe, it, expect } from "vitest";
import { indexComments, lineKeys, linePosition } from "./reviewComments";
import type { DiffLine } from "../types/git";
import type { ReviewThread } from "../types/forge";

const line = (kind: DiffLine["kind"], old_lineno: number | null, new_lineno: number | null): DiffLine => ({ kind, content: "x", old_lineno, new_lineno });

describe("linePosition", () => {
  it("targets the new side, except for removed lines", () => {
    expect(linePosition(line("added", null, 4), "a.ts", null)).toMatchObject({ side: "new", line: 4, oldPath: "a.ts" });
    expect(linePosition(line("removed", 3, null), "a.ts", "old.ts")).toMatchObject({ side: "old", line: 3, oldPath: "old.ts" });
    expect(linePosition(line("context", 2, 5), "a.ts", null)).toMatchObject({ side: "new", line: 5, oldLine: 2, newLine: 5 });
  });
});

describe("lineKeys", () => {
  it("matches context lines on both sides", () => {
    expect(lineKeys(line("context", 2, 5))).toEqual(["new:5", "old:2"]);
    expect(lineKeys(line("added", null, 4))).toEqual(["new:4"]);
    expect(lineKeys(line("removed", 3, null))).toEqual(["old:3"]);
  });
});

describe("indexComments", () => {
  const thread = (id: string, path: string, line: number | null): ReviewThread => ({
    id, replyTo: id, path, side: "new", line, resolved: null, comments: [],
  });

  it("groups threads by line and isolates outdated ones", () => {
    const { threadsByLine, outdated } = indexComments("a.ts", [thread("1", "a.ts", 4), thread("2", "a.ts", null), thread("3", "b.ts", 4)], []);
    expect(threadsByLine.get("new:4")?.map((t) => t.id)).toEqual(["1"]);
    expect(outdated.map((t) => t.id)).toEqual(["2"]);
  });
});
