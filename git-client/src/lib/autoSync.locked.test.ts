// Synchronisation automatique et clé SSH de l'appareil verrouillée (Android, issue #38) : aucune confirmation en
// arrière-plan, et un seul signalement par dépôt au lieu d'une erreur à chaque passage.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/commands", () => ({
  fetchAllQuietly: vi.fn(),
  getBranches: vi.fn(),
  listRemotes: vi.fn(),
}));
vi.mock("../components/PullRequestList", () => ({ linkedForge: () => null, refreshOpenPullRequests: vi.fn() }));
vi.mock("./prNotifications", () => ({ syncMyPullRequests: vi.fn(async () => new Set<string>()) }));

const { syncOpenRepos, isDeviceKeyLocked } = await import("./autoSync");
const { useTabsStore } = await import("../store/useTabsStore");
const { useUiStore } = await import("../store/useUiStore");
const commands = vi.mocked(await import("../ipc/commands"));

const LOCKED = "Échec de la connexion SSH : vérifie ta clé et l'accès au serveur (device-ssh-key-locked: la clé SSH de l'appareil est verrouillée)";

beforeEach(() => {
  vi.clearAllMocks();
  // Aucun onglet actif : chaque onglet donne son propre chemin.
  useTabsStore.setState({ tabs: [{ id: 1, path: "/repos/ssh-projet" }, { id: 2, path: "/repos/https-projet" }] as never, activeId: 0 });
  commands.getBranches.mockResolvedValue([]);
  commands.listRemotes.mockResolvedValue([]);
  commands.fetchAllQuietly.mockImplementation(async (path: string) => {
    if (path === "/repos/ssh-projet") throw LOCKED;
  });
});

describe("syncOpenRepos avec une clé SSH d'appareil verrouillée", () => {
  it("reconnaît le refus de la clé verrouillée, et rien d'autre", () => {
    expect(isDeviceKeyLocked(LOCKED)).toBe(true);
    expect(isDeviceKeyLocked(new Error(LOCKED))).toBe(true);
    expect(isDeviceKeyLocked("Authentification refusée")).toBe(false);
  });

  it("ignore le dépôt SSH, synchronise les autres et ne le signale qu'une fois", async () => {
    const notify = vi.spyOn(useUiStore.getState(), "notify");
    await syncOpenRepos();
    expect(commands.fetchAllQuietly).toHaveBeenCalledWith("/repos/ssh-projet");
    expect(commands.fetchAllQuietly).toHaveBeenCalledWith("/repos/https-projet");
    const paused = notify.mock.calls.filter(([, message]) => String(message).includes("ssh-projet"));
    expect(paused).toHaveLength(1);
    expect(paused[0][0]).toBe("info");
    expect(String(paused[0][1])).toContain("clé SSH de l'appareil est verrouillée");

    await syncOpenRepos();
    expect(notify.mock.calls.filter(([, message]) => String(message).includes("ssh-projet"))).toHaveLength(1);
  });
});
