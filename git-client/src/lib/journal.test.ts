import { describe, it, expect, vi, beforeEach } from "vitest";
import { describeCommand, redactUrl } from "./journal";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args), Channel: class {} }));

const commands = await import("../ipc/commands");
const { useJournalStore } = await import("../store/useJournalStore");

describe("describeCommand", () => {
  it("translates operations into equivalent git commands", () => {
    expect(describeCommand("push", { path: "/r", branch: "main", remote: null, force: true })).toBe("git push --force main");
    expect(describeCommand("pull", { path: "/r", rebase: true })).toBe("git pull --rebase");
    expect(describeCommand("create_commit", { path: "/r", message: "feat: x\n\ndétails", amend: false })).toBe(
      'git commit -m "feat: x"',
    );
    expect(describeCommand("stage_files", { path: "/r", paths: ["a.ts", "dir/b c.ts"] })).toBe('git add -- a.ts "dir/b c.ts"');
    expect(describeCommand("stash_save", { path: "/r", message: null, includeUntracked: true })).toBe("git stash push -u");
    expect(describeCommand("reset_to", { path: "/r", hash: "0123456789abcdef", mode: "hard" })).toBe("git reset --hard 0123456");
    expect(describeCommand("delete_remote_branch", { path: "/r", name: "origin/feat/x" })).toBe("git push origin --delete feat/x");
    expect(describeCommand("fetch_remote", { path: "/r", remote: null })).toBe("git fetch --all --prune");
    expect(describeCommand("rebase_pull_request", { path: "/r", onto: "origin/main", head: "abc", branch: "feat/x" })).toBe(
      "git rebase origin/main feat/x  # en mémoire, copie de travail intacte",
    );
    expect(
      describeCommand("force_push_pull_request", { path: "/r", remote: "origin", branch: "feat/x", expected: "0123456789abcdef" }),
    ).toBe("git push --force-with-lease=feat/x:0123456 origin feat/x");
  });

  it("ignores reads and account operations", () => {
    expect(describeCommand("get_status", { path: "/r" })).toBeNull();
    expect(describeCommand("branch_divergence", { path: "/r", base: "origin/main", head: "origin/x" })).toBeNull();
    expect(describeCommand("add_pat_account", { token: "secret" })).toBeNull();
    expect(describeCommand("terminal_write", { id: 1, data: "ls" })).toBeNull();
  });

  it("never shows credentials embedded in a URL", () => {
    expect(redactUrl("https://user:ghp_secret@github.com/o/r.git")).toBe("https://github.com/o/r.git");
    expect(describeCommand("clone_repository", { url: "https://x:tok@gitlab.com/o/r.git", path: "/home/me/r" })).toBe(
      "git clone --recurse-submodules https://gitlab.com/o/r.git /home/me/r",
    );
    expect(redactUrl("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
  });
});

describe("journaled IPC calls", () => {
  beforeEach(() => {
    useJournalStore.setState({ entries: [] });
    invokeMock.mockReset();
  });

  it("records success, conflicts and errors of mutating commands", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await commands.push("/repo", { branch: "main" });
    invokeMock.mockResolvedValueOnce({ success: false, conflicted_files: ["a.txt"] });
    await commands.pull("/repo", false);
    invokeMock.mockRejectedValueOnce("Push refusé");
    await expect(commands.push("/repo")).rejects.toBe("Push refusé");

    const entries = useJournalStore.getState().entries;
    expect(entries.map((e) => [e.repo, e.command, e.status, e.detail])).toEqual([
      ["/repo", "git push main", "success", undefined],
      ["/repo", "git pull", "warning", "Conflits : a.txt"],
      ["/repo", "git push", "error", "Push refusé"],
    ]);
  });

  it("does not record reads", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await commands.getStatus("/repo");
    expect(useJournalStore.getState().entries).toEqual([]);
  });
});
