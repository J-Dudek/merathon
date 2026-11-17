import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => tauriInvoke(...args),
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));
const tauriListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => tauriListen(...args) }));

describe("choix du transport", () => {
  beforeEach(() => {
    tauriInvoke.mockReset().mockResolvedValue("tauri");
    tauriListen.mockReset().mockResolvedValue(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("passe par Tauri par défaut", async () => {
    const { invokeRaw, createChannel, listenEvent } = await import("./transport");
    await expect(invokeRaw("app_info", { a: 1 })).resolves.toBe("tauri");
    expect(tauriInvoke).toHaveBeenCalledWith("app_info", { a: 1 });

    const handler = vi.fn();
    const channel = createChannel(handler) as { onmessage: (m: unknown) => void };
    channel.onmessage("message");
    expect(handler).toHaveBeenCalledWith("message");

    tauriListen.mockImplementation((_event, callback) => {
      callback({ payload: { message: "x" } });
      return Promise.resolve(() => {});
    });
    const onEvent = vi.fn();
    await listenEvent("debug-log", onEvent);
    expect(onEvent).toHaveBeenCalledWith({ message: "x" });
  });

  it("passe par le serveur quand l'interface est construite pour le NAS", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify("serveur")));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeRaw } = await import("./transport");

    await expect(invokeRaw("app_info")).resolves.toBe("serveur");
    expect(tauriInvoke).not.toHaveBeenCalled();
    expect(String((fetchMock.mock.calls[0][0] as URL).pathname)).toMatch(/api\/invoke\/app_info$/);
  });
});
