import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ipc/commands", () => {
  const info = (path: string) => ({ path, head_branch: "main" });
  return {
    openRepository: vi.fn(async (path: string) => {
      if (path.includes("missing")) throw new Error("introuvable");
      return info(path);
    }),
    getRepoInfo: vi.fn(async (path: string) => info(path)),
    getCommits: vi.fn(async () => []),
    getBranches: vi.fn(async () => []),
    getTags: vi.fn(async () => []),
    listStashes: vi.fn(async () => []),
    listRemotes: vi.fn(async () => []),
    listSubmodules: vi.fn(async () => []),
    lfsStatus: vi.fn(async () => null),
    getStatus: vi.fn(async () => []),
  };
});

const { useTabsStore, currentSession } = await import("./useTabsStore");
const { useRepoStore, emptyRepo } = await import("./useRepoStore");
const commands = await import("../ipc/commands");

const tabs = () => useTabsStore.getState();
const repoPath = () => useRepoStore.getState().repoPath;

beforeEach(async () => {
  // Retour à un seul onglet vide.
  for (const t of tabs().tabs.slice(1)) tabs().closeTab(t.id);
  tabs().closeTab(tabs().activeId);
  useRepoStore.getState().restore(emptyRepo);
  vi.clearAllMocks();
});

describe("useTabsStore", () => {
  it("opens the first repository in the empty tab, then the next ones in new tabs", async () => {
    await tabs().openInTab("/a");
    expect(tabs().tabs).toHaveLength(1);
    expect(repoPath()).toBe("/a");

    await tabs().openInTab("/b");
    expect(tabs().tabs).toHaveLength(2);
    expect(repoPath()).toBe("/b");
    expect(currentSession()).toEqual({ paths: ["/a", "/b"], active: 1 });
  });

  it("switches to the tab of a repository that is already open", async () => {
    await tabs().openInTab("/a");
    await tabs().openInTab("/b");
    await tabs().openInTab("/a/");
    expect(tabs().tabs).toHaveLength(2);
    expect(repoPath()).toBe("/a");
  });

  it("keeps each tab's state and refreshes it when it comes back", async () => {
    await tabs().openInTab("/a");
    useRepoStore.getState().setCommitDraft({ summary: "wip a" });
    await tabs().openInTab("/b");
    expect(useRepoStore.getState().commitDraft.summary).toBe("");

    vi.mocked(commands.getStatus).mockClear();
    await tabs().switchTab(tabs().tabs[0].id);
    expect(repoPath()).toBe("/a");
    expect(useRepoStore.getState().commitDraft.summary).toBe("wip a");
    expect(commands.getStatus).toHaveBeenCalledWith("/a");
  });

  it("activates a neighbour when the active tab is closed, and empties the last tab", async () => {
    await tabs().openInTab("/a");
    await tabs().openInTab("/b");
    tabs().closeTab(tabs().activeId);
    expect(tabs().tabs).toHaveLength(1);
    expect(repoPath()).toBe("/a");

    tabs().closeTab(tabs().activeId);
    expect(tabs().tabs).toHaveLength(1);
    expect(repoPath()).toBeNull();
  });

  it("drops the new tab and goes back when the repository cannot be opened", async () => {
    await tabs().openInTab("/a");
    await tabs().openInTab("/missing");
    expect(tabs().tabs).toHaveLength(1);
    expect(repoPath()).toBe("/a");
  });

  it("restores a session lazily: only the active tab is loaded", async () => {
    await tabs().restoreSession(["/a", "/b", "/c"], 1);
    expect(tabs().tabs.map((t) => t.path)).toEqual(["/a", "/b", "/c"]);
    expect(repoPath()).toBe("/b");
    expect(commands.openRepository).toHaveBeenCalledTimes(1);

    await tabs().switchTab(tabs().tabs[2].id);
    expect(repoPath()).toBe("/c");
    expect(currentSession()).toEqual({ paths: ["/a", "/b", "/c"], active: 2 });
  });

  it("ignores a repository opening that finishes after a tab switch", async () => {
    await tabs().openInTab("/a");
    tabs().newTab();
    let release!: () => void;
    vi.mocked(commands.openRepository).mockImplementationOnce(
      (path: string) => new Promise((resolve) => (release = () => resolve({ path } as never))),
    );
    const pending = useRepoStore.getState().openRepo("/slow");
    await tabs().switchTab(tabs().tabs[0].id);
    release();
    await pending;
    expect(repoPath()).toBe("/a");
  });
});
