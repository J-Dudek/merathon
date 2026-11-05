import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStatus } from "../ipc/commands";
import { emptyRepo, useRepoStore } from "./useRepoStore";
import type { FileStatus } from "../types/git";

vi.mock("../ipc/commands", () => {
  const empty = () => Promise.resolve([]);
  const none = () => Promise.resolve(null);
  return {
    getBranches: empty, getCommits: empty, getTags: empty, listRemotes: empty, listStashes: empty, listSubmodules: empty, listWorktrees: empty,
    getRepoInfo: none, gitIdentityStatus: none, lfsStatus: none, openRepository: none,
    getStatus: vi.fn(),
  };
});

const file = (path: string): FileStatus => ({ path, status: "modified", staged: false });

describe("refresh", () => {
  beforeEach(() => {
    vi.mocked(getStatus).mockReset();
    useRepoStore.setState({ ...emptyRepo, repoPath: "/depot" });
  });

  it("ignore une lecture ancienne qui se termine après une plus récente", async () => {
    let finishOld!: (files: FileStatus[]) => void;
    vi.mocked(getStatus).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    vi.mocked(getStatus).mockResolvedValueOnce([file("recent.txt")]);

    const old = useRepoStore.getState().refresh();
    await useRepoStore.getState().refresh();
    finishOld([file("perime.txt")]);
    await old;

    expect(useRepoStore.getState().status).toEqual([file("recent.txt")]);
  });
});
