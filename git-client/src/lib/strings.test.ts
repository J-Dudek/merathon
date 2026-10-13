import { describe, it, expect } from "vitest";
import { plural, trimEndChars } from "./strings";

describe("trimEndChars", () => {
  it("removes trailing slashes only", () => {
    expect(trimEndChars("https://gitlab.com///")).toBe("https://gitlab.com");
    expect(trimEndChars("https://gitlab.com")).toBe("https://gitlab.com");
    expect(trimEndChars("///")).toBe("");
  });

  it("accepts several characters", () => {
    expect(trimEndChars("C:\\repos\\/", "\\/")).toBe("C:\\repos");
  });
});

describe("plural", () => {
  it("adds an s from two items", () => {
    expect(plural(0, "fichier")).toBe("0 fichier");
    expect(plural(1, "fichier")).toBe("1 fichier");
    expect(plural(3, "fichier")).toBe("3 fichiers");
  });
});
