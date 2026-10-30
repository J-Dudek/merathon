import { describe, it, expect } from "vitest";
import { errorMessage } from "./actions";

describe("errorMessage", () => {
  it("lit le message d'une chaîne, d'une Error ou d'un objet d'erreur", () => {
    expect(errorMessage("refusé")).toBe("refusé");
    expect(errorMessage(new Error("cassé"))).toBe("cassé");
    expect(errorMessage({ message: "plugin indisponible" })).toBe("plugin indisponible");
    expect(errorMessage({ code: 42 })).toBe('{"code":42}');
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
