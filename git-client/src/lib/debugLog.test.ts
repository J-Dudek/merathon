import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cloneRepository, setDebugLogging } from "../ipc/commands";
import { debugLog, redactSecrets, useDebugLogStore } from "../store/useDebugLogStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { logLine, startDebugLogging } from "./debugLog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const messages = () => useDebugLogStore.getState().entries.map((e) => e.message);

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  useDisplayStore.setState({ debugMode: true });
  useDebugLogStore.getState().clear();
});

afterEach(() => {
  useDisplayStore.setState({ debugMode: false });
});

describe("store", () => {
  it("ne garde rien tant que le mode débug est inactif", () => {
    useDisplayStore.setState({ debugMode: false });
    debugLog("info", "ignoré");
    expect(messages()).toEqual([]);
  });

  it("retire les identifiants des URL, partout dans le message", () => {
    expect(redactSecrets("fetch https://user:ghp_secret@github.com/a/b.git puis ssh://git@host/x")).toBe("fetch https://github.com/a/b.git puis ssh://host/x");
    debugLog("error", "échec : https://oauth2:glpat-secret@gitlab.com/a.git");
    expect(messages()[0]).not.toContain("glpat-secret");
  });

  it("borne le nombre de lignes", () => {
    for (let i = 0; i < 2005; i++) debugLog("debug", `${i}`);
    const entries = useDebugLogStore.getState().entries;
    expect(entries).toHaveLength(2000);
    expect(entries[entries.length - 1].message).toBe("2004");
  });
});

describe("appels au backend", () => {
  it("journalise la commande et le dépôt, jamais les autres arguments", async () => {
    await cloneRepository("https://exemple.org/a.git", "/depot");
    const logged = messages().join("\n");
    expect(logged).toContain("clone_repository");
    expect(logged).toContain("done in");
    expect(logged).not.toContain("exemple.org");
  });

  it("garde une trace du début d'une commande qui ne se termine jamais", () => {
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    void cloneRepository("https://exemple.org/a.git", "/depot");
    expect(messages()).toEqual(["clone_repository /depot: start"]);
  });

  it("journalise l'erreur d'une commande", async () => {
    vi.mocked(invoke).mockRejectedValue("connexion refusée");
    await expect(cloneRepository("u", "/depot")).rejects.toBe("connexion refusée");
    const entries = useDebugLogStore.getState().entries;
    expect(entries[entries.length - 1].level).toBe("error");
    expect(entries[entries.length - 1].message).toContain("connexion refusée");
  });

  it("ne journalise rien quand le mode débug est inactif", async () => {
    useDisplayStore.setState({ debugMode: false });
    await cloneRepository("u", "/depot");
    expect(messages()).toEqual([]);
  });
});

describe("startDebugLogging", () => {
  it("collecte console et backend, puis restaure tout et efface les logs à l'arrêt", async () => {
    const original = console.warn;
    console.warn = vi.fn();
    const silent = console.warn;
    const stop = startDebugLogging();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("set_debug_logging", { enabled: true }));

    console.warn("attention", new Error("cassé"));
    expect(silent).toHaveBeenCalled();
    expect(messages()).toContain("attention cassé");

    const onEvent = vi.mocked(listen).mock.calls[0][1];
    onEvent({ event: "debug-log", id: 1, payload: { level: "debug", message: "fetch origin: start" } });
    expect(messages()).toContain("fetch origin: start");

    stop();
    expect(console.warn).toBe(silent);
    expect(messages()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("set_debug_logging", { enabled: false });
    console.warn = original;
  });

  it("n'inscrit pas au journal l'activation du mode", async () => {
    await setDebugLogging(true);
    expect(messages()).toEqual([]);
  });
});

describe("logLine", () => {
  it("donne l'heure, le niveau et le message", () => {
    const time = new Date(2026, 10, 5, 16, 25, 55, 7).getTime();
    expect(logLine({ id: 1, time, level: "warn", message: "lent" })).toBe("16:25:55.007 WARN  lent");
  });
});
