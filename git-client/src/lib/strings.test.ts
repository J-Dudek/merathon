import { describe, it, expect } from "vitest";
import { trimEndChars } from "./strings";

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
