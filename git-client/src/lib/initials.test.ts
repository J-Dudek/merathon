import { describe, it, expect } from "vitest";
import { authorInitials } from "./initials";

describe("authorInitials", () => {
  it("takes the first and last words", () => {
    expect(authorInitials("Julien Dudek")).toBe("JD");
    expect(authorInitials("jean claude van damme")).toBe("JD");
    expect(authorInitials("julien.dudek")).toBe("JD");
  });

  it("handles single words, accents and empty names", () => {
    expect(authorInitials("Julien")).toBe("J");
    expect(authorInitials("élodie")).toBe("É");
    expect(authorInitials("   ")).toBe("?");
  });
});
