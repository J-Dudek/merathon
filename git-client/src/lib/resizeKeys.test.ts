import { describe, expect, it } from "vitest";
import { resizeKeyDelta } from "./resizeKeys";

describe("resizeKeyDelta", () => {
  it("déplace de 16 px avec les flèches de l'axe, 64 px avec Maj", () => {
    expect(resizeKeyDelta({ key: "ArrowRight", shiftKey: false }, "x")).toBe(16);
    expect(resizeKeyDelta({ key: "ArrowLeft", shiftKey: true }, "x")).toBe(-64);
    expect(resizeKeyDelta({ key: "ArrowUp", shiftKey: false }, "y")).toBe(-16);
  });

  it("ignore les autres touches et les flèches de l'autre axe", () => {
    expect(resizeKeyDelta({ key: "ArrowUp", shiftKey: false }, "x")).toBeNull();
    expect(resizeKeyDelta({ key: "Enter", shiftKey: false }, "y")).toBeNull();
  });
});
