// NAS : le bandeau de la synchronisation annonce les commits arrivés depuis ce que la page connaissait, même quand
// une autre page a fetché la première (son propre fetch n'apporte alors rien, voire est sauté par le serveur).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchInfo } from "../types/git";

vi.mock("../ipc/commands", () => ({
  fetchAllQuietly: vi.fn(),
  getBranches: vi.fn(),
  listRemotes: vi.fn(),
}));
vi.mock("../components/PullRequestList", () => ({ linkedForge: () => null, refreshOpenPullRequests: vi.fn() }));
vi.mock("./prNotifications", () => ({ syncMyPullRequests: vi.fn(async () => new Set<string>()) }));

const { syncOpenRepos } = await import("./autoSync");
const { forgetRemoteBranches, rememberRemoteBranchesIfUnknown } = await import("./remoteSnapshots");
const { useTabsStore } = await import("../store/useTabsStore");
const { useUiStore } = await import("../store/useUiStore");
const commands = vi.mocked(await import("../ipc/commands"));

const PATH = "/volume1/git/projet";
const remote = (hash: string): BranchInfo[] => [
  { name: "main", is_remote: false, target_hash: "a1", is_head: true, upstream: "origin/main", ahead: 0, behind: 0 },
  { name: "origin/main", is_remote: true, target_hash: hash, is_head: false, upstream: null, ahead: 0, behind: 0 },
];
/** État du dépôt sur le NAS, que toutes les pages lisent. */
let onDisk = remote("a1");

beforeEach(() => {
  vi.clearAllMocks();
  forgetRemoteBranches(PATH);
  onDisk = remote("a1");
  useTabsStore.setState({ tabs: [{ id: 1, path: PATH }] as never, activeId: 0 });
  commands.getBranches.mockImplementation(async () => onDisk);
  commands.listRemotes.mockResolvedValue([]);
  // Le fetch de cette page n'apporte rien : une autre page a déjà fetché (ou le serveur le saute).
  commands.fetchAllQuietly.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

const banners = (notify: { mock: { calls: unknown[][] } }) => notify.mock.calls.filter((call) => String(call[1]).startsWith("projet"));

describe("bandeau des nouveaux commits", () => {
  it("NAS : signale les commits qu'une autre page a fetchés avant celle-ci", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    const notify = vi.spyOn(useUiStore.getState(), "notify");
    await syncOpenRepos();
    expect(banners(notify)).toHaveLength(0);

    onDisk = remote("b2"); // fetch d'une autre page entre deux synchronisations
    await syncOpenRepos();
    expect(banners(notify)).toHaveLength(1);
    expect(String(banners(notify)[0][1])).toContain("origin/main");

    await syncOpenRepos();
    expect(banners(notify)).toHaveLength(1); // une seule fois
  });

  it("NAS : part de l'état du dépôt à son ouverture, avant la première synchronisation", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    const notify = vi.spyOn(useUiStore.getState(), "notify");
    rememberRemoteBranchesIfUnknown(PATH, remote("a1")); // dépôt affiché par la page
    onDisk = remote("b2");
    await syncOpenRepos();
    expect(banners(notify)).toHaveLength(1);
  });

  it("NAS : n'annonce pas les effets d'une opération réseau lancée par la page", async () => {
    vi.stubEnv("VITE_TARGET", "server");
    const notify = vi.spyOn(useUiStore.getState(), "notify");
    await syncOpenRepos();
    onDisk = remote("b2");
    forgetRemoteBranches(PATH); // push ou fetch de cette page (ownNetwork)
    rememberRemoteBranchesIfUnknown(PATH, onDisk); // rafraîchissement qui le suit
    await syncOpenRepos();
    expect(banners(notify)).toHaveLength(0);
  });

  it("bureau : inchangé, comparaison avant et après son propre fetch", async () => {
    const notify = vi.spyOn(useUiStore.getState(), "notify");
    await syncOpenRepos();
    onDisk = remote("b2");
    rememberRemoteBranchesIfUnknown(PATH, remote("a1"));
    await syncOpenRepos();
    expect(banners(notify)).toHaveLength(0);
  });
});
