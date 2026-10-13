import { describe, it, expect } from "vitest";
import { clickSelection, EMPTY_SELECTION, pruneSelection, type MultiSelection } from "./multiSelect";

const order = ["a", "b", "c", "d", "e"];
const plain = { toggle: false, range: false };
const ctrl = { toggle: true, range: false };
const shift = { toggle: false, range: true };
const ctrlShift = { toggle: true, range: true };

describe("clickSelection", () => {
  it("plain click resets the selection and sets the anchor", () => {
    const sel: MultiSelection = { anchor: "a", items: ["a", "b"] };
    expect(clickSelection(order, sel, "c", plain)).toEqual({ selection: { anchor: "c", items: [] }, plain: true });
  });

  it("ctrl click toggles and includes the current item first", () => {
    const first = clickSelection(order, { anchor: "b", items: [] }, "d", ctrl, { current: "b" }).selection;
    expect(first).toEqual({ anchor: "d", items: ["b", "d"] });
    expect(clickSelection(order, first, "b", ctrl).selection.items).toEqual(["d"]);
  });

  it("shift click selects a range from the anchor, in display order", () => {
    const sel = clickSelection(order, { anchor: "d", items: [] }, "b", shift).selection;
    expect(sel).toEqual({ anchor: "d", items: ["b", "c", "d"] });
    // L'ancre reste fixe : la plage se recalcule depuis elle.
    expect(clickSelection(order, sel, "e", shift).selection.items).toEqual(["d", "e"]);
  });

  it("ctrl + shift adds the range to the selection", () => {
    const sel: MultiSelection = { anchor: "d", items: ["a"] };
    expect(clickSelection(order, sel, "e", ctrlShift).selection.items).toEqual(["a", "d", "e"]);
  });

  it("skips items that cannot be selected", () => {
    const selectable = (i: string) => i !== "c";
    expect(clickSelection(order, { anchor: "a", items: [] }, "e", shift, { selectable }).selection.items).toEqual(["a", "b", "d", "e"]);
    expect(clickSelection(order, EMPTY_SELECTION, "c", ctrl, { selectable }).selection).toEqual({ anchor: "c", items: [] });
  });

  it("shift without anchor behaves like a plain click", () => {
    expect(clickSelection(order, EMPTY_SELECTION, "b", shift).plain).toBe(true);
  });
});

describe("pruneSelection", () => {
  it("drops missing items and keeps the same object otherwise", () => {
    const sel: MultiSelection = { anchor: "a", items: ["a", "b"] };
    expect(pruneSelection(sel, () => true)).toBe(sel);
    expect(pruneSelection(sel, (i) => i === "a").items).toEqual(["a"]);
  });
});
