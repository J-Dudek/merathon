import { describe, it, expect } from "vitest";
import { parseConflicts, resolveWith } from "./ConflictViewer";

const file = [
  "header",
  "<<<<<<< HEAD",
  "ours 1",
  "=======",
  "theirs 1",
  ">>>>>>> feature",
  "middle",
  "<<<<<<< HEAD",
  "ours 2",
  "=======",
  "theirs 2",
  ">>>>>>> feature",
  "footer",
].join("\n");

describe("conflict resolution", () => {
  it("parses each conflict block", () => {
    const sections = parseConflicts(file);
    expect(sections).toHaveLength(2);
    expect(sections[0].ours).toEqual(["ours 1"]);
    expect(sections[1].theirs).toEqual(["theirs 2"]);
  });

  it("applies one choice per block", () => {
    expect(resolveWith(file, ["ours", "theirs"])).toBe("header\nours 1\nmiddle\ntheirs 2\nfooter");
  });

  it("keeps ours before theirs when both are chosen", () => {
    expect(resolveWith(file, ["both", "ours"])).toBe("header\nours 1\ntheirs 1\nmiddle\nours 2\nfooter");
  });
});
