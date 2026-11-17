import { afterEach, describe, expect, it, vi } from "vitest";
import { setViewZoom } from "./nativeWindow";

describe("setViewZoom", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.documentElement.style.removeProperty("zoom");
  });

  it("NAS : laisse la taille au zoom du navigateur, sans zoom CSS qui s'y multiplierait", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    await setViewZoom(1.5);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
  });
});
