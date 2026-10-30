import { describe, it, expect, vi, beforeEach } from "vitest";
import { pushBranch, replyToPushedThreads } from "./threadReplies";
import { THREAD_REPLY_MARKER } from "./threadTrailers";
import { useRepoStore } from "../store/useRepoStore";
import { useAccountsStore } from "../store/useAccountsStore";
import { useUiStore } from "../store/useUiStore";
import type { ForgeClient } from "../api/forge";
import type { ForgeAccount, ReviewThread } from "../types/forge";
import type { BranchInfo } from "../types/git";

const ipc = vi.hoisted(() => ({ commitTrailers: vi.fn(), push: vi.fn() }));
vi.mock("../ipc/commands", () => ipc);

const account = { id: "gl", provider: "gitlab", base_url: "https://gitlab.com", username: "me" } as ForgeAccount;
const thread = (id: string, resolved: boolean | null = false): ReviewThread => ({
  id, replyTo: id, path: "a.ts", side: "new", line: 3, resolved, comments: [{ id: "1", author: "bob", body: "?", createdAt: "" }],
});
const branch = (name: string, hash: string, extra: Partial<BranchInfo> = {}): BranchInfo => ({
  name, is_remote: false, target_hash: hash, is_head: false, upstream: null, ahead: 0, behind: 0, ...extra,
});

let client: Pick<ForgeClient, "getPullRequests" | "getReviewThreads" | "replyToThread" | "resolveThread">;
const notify = vi.fn();
const range = { remote: "origin", branch: "feat", from: "old", to: "new" };

beforeEach(() => {
  vi.clearAllMocks();
  client = {
    getPullRequests: vi.fn().mockResolvedValue([
      { number: 3, sourceBranch: "other", headSha: "x" },
      { number: 7, sourceBranch: "feat", headSha: "new" },
    ]),
    getReviewThreads: vi.fn().mockResolvedValue([thread("t1"), thread("t2")]),
    replyToThread: vi.fn().mockResolvedValue(undefined),
    resolveThread: vi.fn().mockResolvedValue(undefined),
  };
  useRepoStore.setState({ repoPath: "/repo", remotes: [{ name: "origin", url: "git@gitlab.com:grp/app.git" }], refresh: vi.fn().mockResolvedValue(undefined) });
  useAccountsStore.setState({ accounts: [account], client: vi.fn().mockResolvedValue(client) });
  useUiStore.setState({ notify, setBusy: vi.fn() });
  ipc.commitTrailers.mockResolvedValue([
    { hash: "c2", short_hash: "c2", trailers: [["Resolves-Thread", "t1"]] },
    { hash: "c1", short_hash: "c1", trailers: [["Addresses-Thread", "t2"], ["Addresses-Thread", "elsewhere"]] },
  ]);
});

describe("replyToPushedThreads", () => {
  it("replies to and resolves the threads of the pushed branch's pull request", async () => {
    await replyToPushedThreads("/repo", range);
    expect(ipc.commitTrailers).toHaveBeenCalledWith("/repo", "old", "new");
    expect(client.getReviewThreads).toHaveBeenCalledWith("grp/app", 7);
    expect(client.replyToThread).toHaveBeenCalledWith("grp/app", 7, thread("t1"), `Traité dans c2.\n\n${THREAD_REPLY_MARKER}`);
    expect(client.replyToThread).toHaveBeenCalledWith("grp/app", 7, thread("t2"), `Traité dans c1.\n\n${THREAD_REPLY_MARKER}`);
    expect(client.resolveThread).toHaveBeenCalledTimes(1);
    expect(client.resolveThread).toHaveBeenCalledWith("grp/app", 7, thread("t1"), true);
    expect(notify).toHaveBeenCalledWith("success", "2 fils de revue mis à jour sur !7");
  });

  it("does not call the forge when no pushed commit links a thread", async () => {
    ipc.commitTrailers.mockResolvedValue([{ hash: "c1", short_hash: "c1", trailers: [["Signed-off-by", "me"]] }]);
    await replyToPushedThreads("/repo", range);
    expect(useAccountsStore.getState().client).not.toHaveBeenCalled();
  });

  it("uses the known pull request without listing them", async () => {
    await replyToPushedThreads("/repo", range, 9);
    expect(client.getPullRequests).not.toHaveBeenCalled();
    expect(client.getReviewThreads).toHaveBeenCalledWith("grp/app", 9);
  });

  it("keeps going after a failed thread and reports it", async () => {
    vi.mocked(client.replyToThread).mockRejectedValueOnce(new Error("403"));
    await replyToPushedThreads("/repo", range);
    expect(client.replyToThread).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("success", "1 fil de revue mis à jour sur !7");
    expect(notify).toHaveBeenCalledWith("error", "Fils de revue non mis à jour sur !7 : a.ts : 403");
  });
});

describe("pushBranch", () => {
  it("replies for the commits between the old and new remote heads", async () => {
    useRepoStore.setState({ branches: [branch("feat", "new", { upstream: "origin/feat" }), branch("origin/feat", "old", { is_remote: true })] });
    ipc.push.mockImplementation(async () => {
      useRepoStore.setState({ branches: [branch("feat", "new", { upstream: "origin/feat" }), branch("origin/feat", "new", { is_remote: true })] });
    });
    await pushBranch("/repo", "feat", { success: "ok" });
    expect(ipc.push).toHaveBeenCalledWith("/repo", { branch: "feat", force: undefined });
    expect(ipc.commitTrailers).toHaveBeenCalledWith("/repo", "old", "new");
  });

  it("only pushes a branch that is not tracked yet", async () => {
    useRepoStore.setState({ branches: [branch("feat", "new")] });
    ipc.push.mockResolvedValue(undefined);
    await pushBranch("/repo", "feat", { success: "ok" });
    expect(ipc.push).toHaveBeenCalled();
    expect(ipc.commitTrailers).not.toHaveBeenCalled();
  });
});
