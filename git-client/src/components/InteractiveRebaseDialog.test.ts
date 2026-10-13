import { describe, it, expect } from "vitest";
import { moveItem, validatePlan } from "./InteractiveRebaseDialog";

describe("validatePlan", () => {
  it("accepts a regular plan", () => {
    expect(validatePlan([{ action: "pick", message: "" }, { action: "squash", message: "" }])).toBeNull();
  });

  it("rejects squash on the first kept commit", () => {
    expect(validatePlan([{ action: "drop", message: "" }, { action: "fixup", message: "" }])).toMatch(/premier commit/);
  });

  it("rejects dropping everything", () => {
    expect(validatePlan([{ action: "drop", message: "" }])).toMatch(/supprime tous/);
  });

  it("requires a message for reword", () => {
    expect(validatePlan([{ action: "reword", message: "  " }])).toMatch(/message/);
  });
});

describe("moveItem", () => {
  it("moves an item down and up", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same list when nothing moves", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toBe(list);
  });
});
