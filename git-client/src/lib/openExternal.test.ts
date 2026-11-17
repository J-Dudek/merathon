import { afterEach, describe, expect, it, vi } from "vitest";

const tauriOpenUrl = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...args: unknown[]) => tauriOpenUrl(...args) }));

describe("openUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    tauriOpenUrl.mockClear();
  });

  it("ouvre le navigateur du système avec Tauri", async () => {
    const { openUrl } = await import("./openExternal");
    await openUrl("https://github.com");
    expect(tauriOpenUrl).toHaveBeenCalledWith("https://github.com");
  });

  it("ouvre un nouvel onglet, sans lien avec la page, quand Merathon est servi par un NAS", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { openUrl } = await import("./openExternal");
    await openUrl("https://github.com");
    expect(open).toHaveBeenCalledWith("https://github.com", "_blank", "noopener,noreferrer");
    expect(tauriOpenUrl).not.toHaveBeenCalled();
  });
});
