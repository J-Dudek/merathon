import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { clearPullRequestCache, usePullRequests, type LinkedForge } from "./PullRequestList";
import { useAccountsStore } from "../store/useAccountsStore";
import { useSeenPrsStore } from "../store/useSeenPrsStore";
import type { ForgeClient } from "../api/forge";
import type { ForgeAccount, ForgePR } from "../types/forge";

const account: ForgeAccount = { id: "acc", provider: "github", label: "a", base_url: "https://github.com", username: "me", auth: "pat" };
const forge: LinkedForge = { account, projectPath: "o/r", remoteName: "origin" };
const pr = (number: number, state: ForgePR["state"] = "open"): ForgePR => ({
  number, title: `PR ${number}`, state, author: "me", url: "", createdAt: "", updatedAt: "", headSha: "", draft: false, labels: [],
  sourceBranch: `b${number}`, targetBranch: "main", reviewers: [], assignees: [],
});

let getPullRequests: ReturnType<typeof vi.fn>;
let getPullRequest: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearPullRequestCache();
  getPullRequests = vi.fn((_path: string, state: string) => Promise.resolve(state === "merged" ? [pr(1, "merged")] : [pr(4)]));
  getPullRequest = vi.fn((_path: string, n: number) => Promise.resolve({ ...pr(n), commentCount: 3 }));
  useSeenPrsStore.setState({ seen: {} });
  useAccountsStore.setState({ client: async () => ({ getPullRequests, getPullRequest }) as unknown as ForgeClient });
});

describe("usePullRequests", () => {
  it("shows cached pull requests immediately after a remount, while refreshing", async () => {
    const first = renderHook(() => usePullRequests(forge));
    expect(first.result.current.loading).toBe(true);
    await waitFor(() => expect(first.result.current.openPrs.map((p) => p.number)).toEqual([4]));
    first.unmount();

    let release!: (prs: ForgePR[]) => void;
    getPullRequests.mockClear();
    getPullRequests.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const second = renderHook(() => usePullRequests(forge));
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.openPrs.map((p) => p.number)).toEqual([4]);
    await waitFor(() => expect(getPullRequests).toHaveBeenCalledTimes(1));
    expect(second.result.current.openPrs.map((p) => p.number)).toEqual([4]);

    await act(async () => release([pr(4), pr(5)]));
    expect(second.result.current.openPrs.map((p) => p.number)).toEqual([4, 5]);
  });

  it("keeps branch badges while another state filter loads for the first time", async () => {
    const { result } = renderHook(() => usePullRequests(forge));
    await waitFor(() => expect(result.current.openPrs).toHaveLength(1));
    act(() => result.current.setState("merged"));
    expect(result.current.openPrs.map((p) => p.number)).toEqual([4]);
    await waitFor(() => expect(result.current.prs.map((p) => p.number)).toEqual([1]));
    expect(result.current.openPrs.map((p) => p.number)).toEqual([4]);
  });

  it("fetches the comment count of GitHub PRs changed since they were read, and only those", async () => {
    getPullRequests.mockImplementation(() => Promise.resolve([{ ...pr(4), updatedAt: "2" }, { ...pr(5), updatedAt: "2" }, pr(6)]));
    useSeenPrsStore.setState({
      seen: {
        "acc|o/r#4": { head: "", updatedAt: "1", comments: 1, at: 0 },
        "acc|o/r#5": { head: "", updatedAt: "2", at: 0 },
      },
    });
    const { result } = renderHook(() => usePullRequests(forge));
    await waitFor(() => expect(result.current.openPrs).toHaveLength(3));
    expect(getPullRequest).toHaveBeenCalledTimes(1);
    expect(getPullRequest).toHaveBeenCalledWith("o/r", 4);
    expect(result.current.openPrs.map((p) => p.commentCount)).toEqual([3, undefined, undefined]);
  });

  it("forgets read state of PRs no longer open, unless the list is truncated", async () => {
    const entry = { head: "", updatedAt: "", at: 0 };
    useSeenPrsStore.setState({ seen: { "acc|o/r#3": entry, "acc|o/r#4": entry } });
    const { result, unmount } = renderHook(() => usePullRequests(forge));
    await waitFor(() => expect(result.current.openPrs).toHaveLength(1));
    expect(Object.keys(useSeenPrsStore.getState().seen)).toEqual(["acc|o/r#4"]);
    unmount();

    clearPullRequestCache();
    useSeenPrsStore.setState({ seen: { "acc|o/r#999": entry } });
    getPullRequests.mockImplementation(() => Promise.resolve(Array.from({ length: 50 }, (_, i) => pr(i + 1))));
    const full = renderHook(() => usePullRequests(forge));
    await waitFor(() => expect(full.result.current.openPrs).toHaveLength(50));
    expect(Object.keys(useSeenPrsStore.getState().seen)).toEqual(["acc|o/r#999"]);
  });
});
