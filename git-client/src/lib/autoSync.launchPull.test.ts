// Android : pull des dépôts ouverts au lancement, en fast-forward seulement.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/commands", () => ({
  fetchAllQuietly: vi.fn(),
  getBranches: vi.fn(),
  listRemotes: vi.fn(),
  pullFastForward: vi.fn(),
}));
vi.mock("../components/PullRequestList", () => ({ linkedForge: () => null, refreshOpenPullRequests: vi.fn() }));
vi.mock("./prNotifications", () => ({ syncMyPullRequests: vi.fn(async () => new Set<string>()) }));

const { describePull, pullOpenRepos } = await import("./autoSync");
const { useTabsStore } = await import("../store/useTabsStore");
const { useRepoStore } = await import("../store/useRepoStore");
const { useUiStore } = await import("../store/useUiStore");
const commands = vi.mocked(await import("../ipc/commands"));

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ busy: null } as never);
});

describe("describePull", () => {
  it("signale les commits récupérés et les pulls non faits, rien quand il n'y a rien à tirer", () => {
    expect(describePull("app", { kind: "updated", commits: 1, branch: "main" })).toBe("app : 1 nouveau commit récupéré sur main");
    expect(describePull("app", { kind: "updated", commits: 3, branch: "main" })).toBe("app : 3 nouveaux commits récupérés sur main");
    expect(describePull("app", { kind: "diverged", branch: "main" })).toContain("merge ou rebase à faire");
    expect(describePull("app", { kind: "localChanges", branch: "main" })).toContain("seraient écrasées");
    expect(describePull("app", { kind: "upToDate" })).toBeNull();
    expect(describePull("app", { kind: "skipped" })).toBeNull();
  });
});

describe("pullOpenRepos", () => {
  it("tire chaque dépôt ouvert, recharge celui affiché et continue après un échec", async () => {
    useTabsStore.setState({ tabs: [{ id: 1, path: "/repos/a" }, { id: 2, path: "/repos/b" }, { id: 3, path: "/repos/c" }] as never, activeId: 1 });
    const refresh = vi.fn(async () => {});
    useRepoStore.setState({ repoPath: "/repos/a", refresh });
    commands.pullFastForward.mockImplementation(async (path: string) => {
      if (path === "/repos/a") return { kind: "updated", commits: 2, branch: "main" };
      if (path === "/repos/b") throw new Error("hors ligne");
      return { kind: "diverged", branch: "dev" };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notify = vi.spyOn(useUiStore.getState(), "notify");

    await pullOpenRepos();

    expect(commands.pullFastForward.mock.calls.map(([p]) => p)).toEqual(["/repos/a", "/repos/b", "/repos/c"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("success", "a : 2 nouveaux commits récupérés sur main");
    expect(notify).toHaveBeenCalledWith("info", expect.stringContaining("c : pull non fait"));
    expect(notify.mock.calls.some(([, m]) => String(m).includes("hors ligne"))).toBe(false);
    warn.mockRestore();
  });

  it("n'intervient pas pendant une opération lancée par l'utilisateur", async () => {
    useTabsStore.setState({ tabs: [{ id: 1, path: "/repos/a" }] as never, activeId: 0 });
    useUiStore.setState({ busy: "Push…" } as never);
    await pullOpenRepos();
    expect(commands.pullFastForward).not.toHaveBeenCalled();
  });
});
