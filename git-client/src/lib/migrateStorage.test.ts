import { beforeEach, describe, expect, it } from "vitest";
import { migrateStorage } from "./migrateStorage";

describe("migrateStorage", () => {
  beforeEach(() => localStorage.clear());

  it("reprend les réglages de l'ancien préfixe et les retire", () => {
    localStorage.setItem("git-client.display", "{\"zoom\":1.2}");
    localStorage.setItem("git-client.modal.git-memo", "{}");
    localStorage.setItem("autre", "x");

    migrateStorage(localStorage);

    expect(localStorage.getItem("merathon.display")).toBe("{\"zoom\":1.2}");
    expect(localStorage.getItem("merathon.modal.git-memo")).toBe("{}");
    expect(localStorage.getItem("git-client.display")).toBeNull();
    expect(localStorage.getItem("autre")).toBe("x");
  });

  it("n'écrase pas une valeur déjà enregistrée sous le nouveau préfixe", () => {
    localStorage.setItem("git-client.display", "ancien");
    localStorage.setItem("merathon.display", "nouveau");

    migrateStorage(localStorage);

    expect(localStorage.getItem("merathon.display")).toBe("nouveau");
    expect(localStorage.getItem("git-client.display")).toBeNull();
  });
});
