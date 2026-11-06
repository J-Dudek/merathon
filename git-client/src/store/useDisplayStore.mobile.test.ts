import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("defaultDisplay", () => {
  it("uses the comfortable graph density on Android (touch targets)", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36");
    vi.resetModules();
    const { defaultDisplay } = await import("./useDisplayStore");
    expect(defaultDisplay.density).toBe("comfortable");
  });

  it("keeps the normal density on desktop", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    vi.resetModules();
    const { defaultDisplay } = await import("./useDisplayStore");
    expect(defaultDisplay.density).toBe("normal");
  });
});
