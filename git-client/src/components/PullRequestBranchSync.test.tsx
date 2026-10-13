import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PullRequestBranchSync } from "./PullRequestBranchSync";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import type { PullRequestDetails } from "../types/forge";

const ipc = vi.hoisted(() => ({
  fetchRemoteQuietly: vi.fn(),
  branchDivergence: vi.fn(),
  rebasePullRequest: vi.fn(),
  discardPullRequestRebase: vi.fn(),
  forcePushPullRequest: vi.fn(),
}));
vi.mock("../ipc/commands", () => ipc);

const HEAD = "a".repeat(40);
const details = {
  pr: { number: 7, sourceBranch: "feat/x", targetBranch: "main", state: "open" },
  headSha: HEAD,
} as unknown as PullRequestDetails;

function renderSync(onPushed = vi.fn(), onCheckout = vi.fn()) {
  render(<PullRequestBranchSync details={details} remoteName="origin" onPushed={onPushed} onCheckout={onCheckout} />);
  return { onPushed, onCheckout };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.fetchRemoteQuietly.mockResolvedValue(undefined);
  ipc.discardPullRequestRebase.mockResolvedValue(undefined);
  ipc.branchDivergence.mockResolvedValue({ head: HEAD, ahead: 2, behind: 3 });
  useRepoStore.setState({ repoPath: "/repo", refresh: vi.fn().mockResolvedValue(undefined) });
  // Toute confirmation est acceptée.
  useUiStore.setState({ ask: vi.fn().mockResolvedValue({ value: "", checked: false }), notify: vi.fn() });
});

describe("PullRequestBranchSync", () => {
  it("shows how far behind the target the branch is, after fetching", async () => {
    renderSync();
    expect(await screen.findByText("En retard de 3 commits sur main.")).toBeTruthy();
    expect(ipc.fetchRemoteQuietly).toHaveBeenCalledWith("/repo", "origin");
    expect(ipc.branchDivergence).toHaveBeenCalledWith("/repo", "origin/main", "origin/feat/x");
  });

  it("says the branch is up to date", async () => {
    ipc.branchDivergence.mockResolvedValue({ head: HEAD, ahead: 2, behind: 0 });
    renderSync();
    expect(await screen.findByText("✓ À jour avec main")).toBeTruthy();
    expect(screen.queryByText(/Rebaser/)).toBeNull();
  });

  it("does not offer a rebase when the local branch is not the PR head (fork)", async () => {
    ipc.branchDivergence.mockResolvedValue({ head: "b".repeat(40), ahead: 1, behind: 3 });
    renderSync();
    expect(await screen.findByText(/ne correspond pas à la tête de la PR/)).toBeTruthy();
    expect(screen.queryByText(/Rebaser/)).toBeNull();
  });

  it("asks to checkout when the automatic rebase conflicts", async () => {
    ipc.rebasePullRequest.mockResolvedValue({ success: false, conflicted_files: ["src/a.ts"], new_head: null, commits: 0, skipped: 0 });
    const { onCheckout } = renderSync();
    fireEvent.click(await screen.findByText("Rebaser sur main"));
    expect(await screen.findByText("Rebase auto impossible, merci de checkout la branche.")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.queryByText("Force push")).toBeNull();
    fireEvent.click(screen.getByText("Checkout"));
    expect(onCheckout).toHaveBeenCalled();
  });

  it("offers a force push with lease once the rebase succeeded", async () => {
    const NEW = "c".repeat(40);
    ipc.rebasePullRequest.mockResolvedValue({ success: true, conflicted_files: [], new_head: NEW, commits: 2, skipped: 0 });
    ipc.forcePushPullRequest.mockResolvedValue({ new_head: NEW, local_branch: "updated" });
    const { onPushed } = renderSync();

    fireEvent.click(await screen.findByText("Rebaser sur main"));
    expect(ipc.rebasePullRequest).toHaveBeenCalledWith("/repo", "origin/main", HEAD, "feat/x");
    fireEvent.click(await screen.findByText("Force push"));

    expect(await screen.findByText("✓ À jour avec main")).toBeTruthy();
    // Le lease porte sur la tête qui a été rebasée.
    expect(ipc.forcePushPullRequest).toHaveBeenCalledWith("/repo", "origin", "feat/x", HEAD);
    expect(onPushed).toHaveBeenCalled();
  });
});
