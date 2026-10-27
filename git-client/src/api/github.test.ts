import { describe, it, expect, vi } from "vitest";
import { GitHubClient } from "./github";
import type { NewPullRequest } from "../types/forge";

/** `get` simulé : enregistre les chemins demandés au backend et renvoie `data`. */
function client(data: unknown) {
  const get = vi.fn().mockResolvedValue(data);
  return { gh: new GitHubClient(get as never), get };
}

describe("GitHubClient", () => {
  it("getPullRequests maps fields to ForgePR", async () => {
    const { gh, get } = client([{
      number: 42, title: "Add feature", state: "open", merged_at: null, draft: false,
      user: { login: "alice" }, html_url: "https://github.com/o/r/pull/42",
      created_at: "2024-01-01T00:00:00Z", labels: [{ name: "enhancement" }],
      base: { ref: "main" }, head: { ref: "feature/x" },
    }]);
    const prs = await gh.getPullRequests("owner", "repo");

    expect(get).toHaveBeenCalledWith("/repos/owner/repo/pulls?state=open&per_page=50");
    expect(prs[0]).toMatchObject({ number: 42, state: "open", author: "alice", sourceBranch: "feature/x", targetBranch: "main", labels: ["enhancement"] });
  });

  it("flags open PRs approved by review, and leaves them unflagged when reviews are unavailable", async () => {
    const raw = (number: number, state = "open") => ({ number, title: "t", state, merged_at: null, created_at: "2024-01-01" });
    const get = vi.fn().mockResolvedValue([raw(1), raw(2), raw(3), raw(4, "closed")]);
    const node = (number: number, reviewDecision: string | null, states: string[]) =>
      ({ number, reviewDecision, latestOpinionatedReviews: { nodes: states.map((state) => ({ state })) } });
    const graphql = vi.fn().mockResolvedValue({
      repository: { pullRequests: { nodes: [node(1, "APPROVED", []), node(2, null, ["APPROVED"]), node(3, "REVIEW_REQUIRED", ["APPROVED"])] } },
    });
    const prs = await new GitHubClient(get as never, undefined, graphql as never).getPullRequests("o", "r", "all");

    expect(prs.map((p) => p.approved)).toEqual([true, true, false, undefined]);
    expect(graphql.mock.calls[0][1]).toEqual({ owner: "o", repo: "r" });
    expect((await new GitHubClient(get as never).getPullRequests("o", "r"))[0].approved).toBeUndefined();
  });

  it("getPullRequest counts conversation and line comments", async () => {
    const { gh, get } = client({ number: 7, title: "t", state: "open", merged_at: null, updated_at: "2024-01-03", head: { ref: "x", sha: "abc" }, comments: 2, review_comments: 3 });
    expect(await gh.getPullRequest("o", "r", 7)).toMatchObject({ updatedAt: "2024-01-03", headSha: "abc", commentCount: 5 });
    expect(get).toHaveBeenCalledWith("/repos/o/r/pulls/7");
  });

  it("marks merged PRs", async () => {
    const { gh } = client([{ number: 1, title: "t", state: "closed", merged_at: "2024-01-02", labels: [] }]);
    expect((await gh.getPullRequests("o", "r"))[0].state).toBe("merged");
  });

  it("getIssues excludes pull requests", async () => {
    const { gh } = client([
      { number: 1, title: "Bug", state: "open", user: { login: "bob" }, labels: [] },
      { number: 2, title: "PR", state: "open", pull_request: {}, labels: [] },
    ]);
    const issues = await gh.getIssues("o", "r");
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("searchIssues fetches an issue by number, and finds nothing for a pull request or a missing issue", async () => {
    const { gh, get } = client({ number: 9, title: "Bug", state: "closed", user: { login: "bob" }, labels: [] });
    expect(await gh.searchIssues("o", "r", " 9 ")).toMatchObject([{ number: 9, state: "closed" }]);
    expect(get).toHaveBeenCalledWith("/repos/o/r/issues/9");
    get.mockResolvedValueOnce({ number: 10, title: "PR", state: "open", pull_request: {} });
    expect(await gh.searchIssues("o", "r", "10")).toEqual([]);
    get.mockRejectedValueOnce("Introuvable (404)");
    expect(await gh.searchIssues("o", "r", "11")).toEqual([]);
  });

  it("searchIssues searches words among the repository's issues", async () => {
    const { gh, get } = client({ items: [{ number: 3, title: "Crash", state: "open", labels: [] }] });
    expect((await gh.searchIssues("o", "r", "crash login")).map((i) => i.number)).toEqual([3]);
    expect(get).toHaveBeenCalledWith(`/search/issues?q=${encodeURIComponent("repo:o/r is:issue crash login")}&per_page=20`);
  });

  it("encodes owner and repo in the path", async () => {
    const { gh, get } = client([]);
    await gh.getIssues("o/../x", "r?y");
    expect(get).toHaveBeenCalledWith("/repos/o%2F..%2Fx/r%3Fy/issues?state=open&per_page=50");
  });

  it("propagates backend errors", async () => {
    const get = vi.fn().mockRejectedValue("Token refusé (401/403)");
    await expect(new GitHubClient(get as never).getPullRequests("o", "r")).rejects.toBe("Token refusé (401/403)");
  });

  it("getCurrentUser returns the login", async () => {
    const { gh, get } = client({ login: "alice" });
    expect(await gh.getCurrentUser()).toBe("alice");
    expect(get).toHaveBeenCalledWith("/user");
  });

  it("listRepos maps clone URLs", async () => {
    const { gh } = client([{ name: "r", full_name: "o/r", clone_url: "https://github.com/o/r.git", ssh_url: "git@github.com:o/r.git", private: true, description: null, updated_at: "2024-01-01" }]);
    const repos = await gh.listRepos();
    expect(repos[0]).toMatchObject({ fullName: "o/r", cloneUrl: "https://github.com/o/r.git", private: true, description: "" });
  });
});

describe("GitHubClient.createPullRequest", () => {
  const input: NewPullRequest = {
    sourceBranch: "feat/x", targetBranch: "main", title: "feat: x", description: "desc", draft: true,
    assignees: [{ id: 1, username: "alice", name: "alice" }], reviewers: [{ id: 2, username: "bob", name: "bob" }],
    labels: ["bug"], milestone: { id: 3, title: "v2" }, removeSourceBranch: true, squash: true,
  };
  const created = { number: 7, title: "feat: x", state: "open", merged_at: null, html_url: "https://github.com/o/r/pull/7", labels: [] };

  it("creates the PR then requests reviewers and sets assignees, labels and milestone", async () => {
    const send = vi.fn().mockResolvedValue(created);
    const gh = new GitHubClient(vi.fn() as never, send as never);
    const { pr, warnings } = await gh.createPullRequest("o", "r", input);

    expect(send.mock.calls).toEqual([
      ["POST", "/repos/o/r/pulls", { title: "feat: x", body: "desc", head: "feat/x", base: "main", draft: true }],
      ["POST", "/repos/o/r/pulls/7/requested_reviewers", { reviewers: ["bob"] }],
      ["PATCH", "/repos/o/r/issues/7", { assignees: ["alice"], labels: ["bug"], milestone: 3 }],
    ]);
    expect(pr).toMatchObject({ number: 7, url: "https://github.com/o/r/pull/7" });
    expect(warnings).toEqual([]);
  });

  it("keeps the PR when a follow-up step fails", async () => {
    const send = vi.fn().mockResolvedValueOnce(created).mockRejectedValueOnce("422 reviewer").mockResolvedValue({});
    const { warnings } = await new GitHubClient(vi.fn() as never, send as never).createPullRequest("o", "r", input);
    expect(warnings).toEqual(["relecteurs : 422 reviewer"]);
  });

  it("skips follow-up calls when nothing else is set", async () => {
    const send = vi.fn().mockResolvedValue(created);
    await new GitHubClient(vi.fn() as never, send as never).createPullRequest("o", "r", {
      ...input, assignees: [], reviewers: [], labels: [], milestone: null,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("GitHubClient pull request review", () => {
  const base = "/repos/o/r";
  const pull = {
    number: 7, title: "feat: x", state: "open", merged_at: null, user: { login: "alice" }, html_url: "u", created_at: "d",
    labels: [], head: { ref: "feat/x", sha: "abc" }, base: { ref: "main" }, body: "desc",
    requested_reviewers: [{ login: "carol" }], assignees: [{ login: "alice" }], mergeable: true, mergeable_state: "clean",
  };
  const reviews = [
    { id: 1, user: { login: "bob" }, state: "CHANGES_REQUESTED", body: "fix", submitted_at: "2024-01-02" },
    { id: 2, user: { login: "bob" }, state: "APPROVED", body: "", submitted_at: "2024-01-03" },
    { id: 3, user: { login: "bob" }, state: "COMMENTED", body: "nit", submitted_at: "2024-01-04" },
    { id: 4, user: { login: "dave" }, state: "CHANGES_REQUESTED", body: "no", submitted_at: "2024-01-05" },
  ];
  function detailsClient(overrides: Record<string, unknown> = {}) {
    const responses: Record<string, unknown> = {
      [`${base}/pulls/7`]: pull,
      [base]: { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true, permissions: { push: true } },
      [`${base}/pulls/7/reviews?per_page=100`]: reviews,
      [`${base}/commits/abc/check-runs?per_page=100`]: { check_runs: [
        { name: "test", status: "completed", conclusion: "success", html_url: "t" },
        { name: "lint", status: "in_progress", conclusion: null, html_url: null },
      ] },
      [`${base}/commits/abc/status`]: { statuses: [{ context: "ci/legacy", state: "error", target_url: null }] },
      "/users/carol": { login: "carol", name: "Carol Petit" },
      "/users/alice": { login: "alice", name: null },
      ...overrides,
    };
    return new GitHubClient(vi.fn((path: string) => Promise.resolve(responses[path])) as never);
  }

  it("keeps the latest verdict per reviewer, ignoring plain comments", async () => {
    const d = await detailsClient().getPullRequestDetails("o", "r", 7, "bob");
    expect(d.approvedBy).toEqual(["bob"]);
    expect(d.changesRequestedBy).toEqual(["dave"]);
    expect(d.approvedByMe).toBe(true);
    expect(d.pr).toMatchObject({ reviewers: ["carol"], assignees: ["alice"] });
    expect(d.names).toEqual({ carol: "Carol Petit" });
  });

  it("maps checks, statuses and allowed merge methods", async () => {
    const d = await detailsClient().getPullRequestDetails("o", "r", 7, "me");
    expect(d.checks.map((c) => [c.name, c.status])).toEqual([["test", "success"], ["lint", "pending"], ["ci/legacy", "failure"]]);
    expect(d.mergeMethods).toEqual(["squash", "rebase"]);
    expect(d.defaultMergeMethod).toBe("squash");
    expect(d).toMatchObject({ mergeable: true, mergeStatus: "Prête à merger", headSha: "abc", description: "desc" });
  });

  it("is not mergeable while GitHub computes mergeability or when behind", async () => {
    const computing = await detailsClient({ [`${base}/pulls/7`]: { ...pull, mergeable: null, mergeable_state: "unknown" } })
      .getPullRequestDetails("o", "r", 7, "me");
    expect(computing.mergeable).toBe(false);
    const behind = await detailsClient({ [`${base}/pulls/7`]: { ...pull, mergeable_state: "behind" } })
      .getPullRequestDetails("o", "r", 7, "me");
    expect(behind).toMatchObject({ mergeable: false, canUpdateBranch: true });
  });

  it("allows a forced merge of a blocked PR only when the viewer can bypass the requirements", async () => {
    const responses: Record<string, unknown> = { [base]: {}, [`${base}/pulls/7/reviews?per_page=100`]: [] };
    const details = (state: string, admin: boolean | Error, mergeable: boolean | null = true) => {
      const all: Record<string, unknown> = { ...responses, [`${base}/pulls/7`]: { ...pull, mergeable, mergeable_state: state } };
      const get = vi.fn((path: string) => (path in all ? Promise.resolve(all[path]) : Promise.reject(new Error(path))));
      const graphql = vi.fn(() => admin instanceof Error
        ? Promise.reject(admin)
        : Promise.resolve({ repository: { pullRequest: { viewerCanMergeAsAdmin: admin } } }));
      return { graphql, result: new GitHubClient(get as never, undefined, graphql as never).getPullRequestDetails("o", "r", 7, "me") };
    };

    expect(await details("blocked", true).result).toMatchObject({ mergeable: false, canForceMerge: true, canAutoMerge: false });
    expect(await details("blocked", false).result).toMatchObject({ canForceMerge: false });
    expect(await details("blocked", new Error("scope")).result).toMatchObject({ canForceMerge: false });
    expect(await details("dirty", true, false).result).toMatchObject({ canForceMerge: false });
    const clean = details("clean", true);
    expect(await clean.result).toMatchObject({ mergeable: true, canForceMerge: false });
    expect(clean.graphql).not.toHaveBeenCalled();
  });

  it("tolerates a token without access to checks", async () => {
    const responses: Record<string, unknown> = { [`${base}/pulls/7`]: pull, [base]: {}, [`${base}/pulls/7/reviews?per_page=100`]: [] };
    const get = vi.fn((path: string) => path.includes("/commits/") ? Promise.reject(new Error("403")) : Promise.resolve(responses[path]));
    const d = await new GitHubClient(get as never).getPullRequestDetails("o", "r", 7, "me");
    expect(d.checks).toEqual([]);
    expect(d.mergeMethods).toEqual(["merge", "squash", "rebase"]);
  });

  it("merges conversation comments and review bodies by date", async () => {
    const responses: Record<string, unknown> = {
      [`${base}/issues/7/comments?per_page=100`]: [{ id: 9, user: { login: "eve" }, body: "hello", created_at: "2024-01-01" }],
      [`${base}/pulls/7/reviews?per_page=100`]: reviews,
    };
    const gh = new GitHubClient(vi.fn((path: string) => Promise.resolve(responses[path])) as never);
    const comments = await gh.getComments("o", "r", 7);
    expect(comments.map((c) => [c.id, c.review])).toEqual([
      ["c9", undefined], ["r1", "changes_requested"], ["r2", "approved"], ["r3", undefined], ["r4", "changes_requested"],
    ]);
  });

  it("filters merged and closed PRs from the closed list", async () => {
    const closed = [{ ...pull, number: 1, state: "closed", merged_at: "x" }, { ...pull, number: 2, state: "closed", merged_at: null }];
    const get = vi.fn().mockResolvedValue(closed);
    const gh = new GitHubClient(get as never);
    expect((await gh.getPullRequests("o", "r", "merged")).map((p) => p.number)).toEqual([1]);
    expect((await gh.getPullRequests("o", "r", "closed")).map((p) => p.number)).toEqual([2]);
    expect(get).toHaveBeenCalledWith(`${base}/pulls?state=closed&per_page=50`);
  });

  it("sends review, merge, state and branch update requests", async () => {
    const send = vi.fn().mockResolvedValue(null);
    const gh = new GitHubClient(vi.fn() as never, send as never);
    await gh.addComment("o", "r", 7, "hi");
    await gh.review("o", "r", 7, "request_changes", "please fix");
    await gh.merge("o", "r", 7, { method: "squash", sha: "abc", removeSourceBranch: true });
    await gh.setState("o", "r", 7, "closed");
    await gh.updateBranch("o", "r", 7, "abc");
    expect(send.mock.calls).toEqual([
      ["POST", `${base}/issues/7/comments`, { body: "hi" }],
      ["POST", `${base}/pulls/7/reviews`, { event: "REQUEST_CHANGES", body: "please fix" }],
      ["PUT", `${base}/pulls/7/merge`, { merge_method: "squash", sha: "abc" }],
      ["PATCH", `${base}/pulls/7`, { state: "closed" }],
      ["PUT", `${base}/pulls/7/update-branch`, { expected_head_sha: "abc" }],
    ]);
    await expect(gh.review("o", "r", 7, "unapprove", "")).rejects.toThrow();
  });
});

describe("GitHubClient.updatePullRequest", () => {
  it("sends the new title and body", async () => {
    const send = vi.fn().mockResolvedValue(null);
    await new GitHubClient(vi.fn() as never, send as never).updatePullRequest("o", "r", 7, { title: "Nouveau", description: "Closes #3" });
    expect(send).toHaveBeenCalledWith("PATCH", "/repos/o/r/pulls/7", { title: "Nouveau", body: "Closes #3" });
  });
});

describe("GitHubClient.setDraft", () => {
  it("uses the GraphQL mutation matching the requested state", async () => {
    const get = vi.fn().mockResolvedValue({ number: 7, node_id: "PR_kw" });
    const graphql = vi.fn().mockResolvedValue({});
    const gh = new GitHubClient(get as never, vi.fn() as never, graphql as never);
    await gh.setDraft("o", "r", 7, false);
    await gh.setDraft("o", "r", 7, true);
    expect(get).toHaveBeenCalledWith("/repos/o/r/pulls/7");
    expect(graphql.mock.calls[0][0]).toContain("markPullRequestReadyForReview");
    expect(graphql.mock.calls[1][0]).toContain("convertPullRequestToDraft");
    expect(graphql.mock.calls[0][1]).toEqual({ id: "PR_kw" });
  });
});

describe("GitHubClient inline review", () => {
  const ctx = { headSha: "abc", diffRefs: null };
  const added = { path: "src/a.ts", oldPath: "src/a.ts", side: "new" as const, line: 4, oldLine: null, newLine: 4 };
  const removed = { path: "src/a.ts", oldPath: "src/a.ts", side: "old" as const, line: 3, oldLine: 3, newLine: null };

  it("maps GraphQL review threads", async () => {
    const graphql = vi.fn().mockResolvedValue({ repository: { pullRequest: { reviewThreads: { nodes: [{
      id: "T_1", isResolved: true, path: "src/a.ts", line: null, diffSide: "LEFT",
      comments: { nodes: [{ databaseId: 11, body: "why?", createdAt: "d", author: { login: "bob" } }] },
    }] } } } });
    const gh = new GitHubClient(vi.fn() as never, vi.fn() as never, graphql as never);
    const [thread] = await gh.getReviewThreads("o", "r", 7);
    expect(graphql.mock.calls[0][1]).toEqual({ owner: "o", name: "r", number: 7 });
    expect(thread).toEqual({
      id: "T_1", replyTo: "11", path: "src/a.ts", side: "old", line: null, resolved: true,
      comments: [{ id: "11", author: "bob", body: "why?", createdAt: "d" }],
    });
  });

  it("comments a line on the head commit, replies and resolves", async () => {
    const send = vi.fn().mockResolvedValue(null);
    const graphql = vi.fn().mockResolvedValue({});
    const gh = new GitHubClient(vi.fn() as never, send as never, graphql as never);
    await gh.addLineComment("o", "r", 7, ctx, removed, "gone?");
    await gh.replyToThread("o", "r", 7, "11", "yes");
    await gh.resolveThread("T_1", true);
    expect(send.mock.calls).toEqual([
      ["POST", "/repos/o/r/pulls/7/comments", { body: "gone?", commit_id: "abc", path: "src/a.ts", line: 3, side: "LEFT" }],
      ["POST", "/repos/o/r/pulls/7/comments/11/replies", { body: "yes" }],
    ]);
    expect(graphql.mock.calls[0][0]).toContain("resolveReviewThread");
    expect(graphql.mock.calls[0][1]).toEqual({ id: "T_1" });
  });

  it("submits the review and its line comments in one request", async () => {
    const send = vi.fn().mockResolvedValue({});
    const gh = new GitHubClient(vi.fn() as never, send as never);
    const result = await gh.submitReview("o", "r", 7, ctx, {
      verdict: "request_changes", body: "see comments", comments: [{ id: "d1", position: added, body: "rename" }],
    });
    expect(send).toHaveBeenCalledWith("POST", "/repos/o/r/pulls/7/reviews", {
      commit_id: "abc", event: "REQUEST_CHANGES", body: "see comments",
      comments: [{ body: "rename", path: "src/a.ts", line: 4, side: "RIGHT" }],
    });
    expect(result).toEqual({ publishedIds: ["d1"], errors: [] });
  });

  it("getPullRequestTemplates reads the default template and the template folder", async () => {
    const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const files: Record<string, unknown> = {
      "/repos/o/r/contents/.github": [
        { name: "PULL_REQUEST_TEMPLATE.md", path: ".github/PULL_REQUEST_TEMPLATE.md", type: "file" },
        { name: "PULL_REQUEST_TEMPLATE", path: ".github/PULL_REQUEST_TEMPLATE", type: "dir" },
      ],
      "/repos/o/r/contents": [{ name: "README.md", path: "README.md", type: "file" }],
      "/repos/o/r/contents/.github/PULL_REQUEST_TEMPLATE": [{ name: "bug.md", path: ".github/PULL_REQUEST_TEMPLATE/bug.md", type: "file" }],
      "/repos/o/r/contents/.github/PULL_REQUEST_TEMPLATE.md": { encoding: "base64", content: b64("## Résumé\n") },
      "/repos/o/r/contents/.github/PULL_REQUEST_TEMPLATE/bug.md": { encoding: "base64", content: b64("## Bug\n") },
    };
    const get = vi.fn((path: string) => (path in files ? Promise.resolve(files[path]) : Promise.reject(new Error("404"))));
    const result = await new GitHubClient(get as never).getPullRequestTemplates("o", "r");

    expect(result).toEqual({
      templates: [
        { name: ".github/PULL_REQUEST_TEMPLATE.md", content: "## Résumé\n" },
        { name: "bug", content: "## Bug\n" },
      ],
      defaultName: ".github/PULL_REQUEST_TEMPLATE.md",
    });
  });

  it("getPullRequestTemplates returns nothing when the repository has no template", async () => {
    const get = vi.fn((path: string) => (path === "/repos/o/r/contents" ? Promise.resolve([]) : Promise.reject(new Error("404"))));
    expect(await new GitHubClient(get as never).getPullRequestTemplates("o", "r")).toEqual({ templates: [], defaultName: null });
  });

  it("getMyPullRequests merges assigned and review-requested PRs and derives their status", async () => {
    const node = (number: number, extra: Record<string, unknown> = {}) => ({
      number, title: `PR ${number}`, url: "u", createdAt: "c", updatedAt: "u", isDraft: false, headRefName: "x", baseRefName: "main",
      headRefOid: "sha", author: { login: "me" }, repository: { nameWithOwner: "o/r" }, labels: { nodes: [] },
      assignees: { nodes: [] }, reviewRequests: { nodes: [] }, reviewDecision: null, latestOpinionatedReviews: { nodes: [] },
      mergeable: "MERGEABLE", commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] }, ...extra,
    });
    const graphql = vi.fn().mockResolvedValue({
      assigned: { nodes: [node(1), {}] },
      reviewing: { nodes: [node(1), node(2, { reviewDecision: "CHANGES_REQUESTED" })] },
      authored: { nodes: [node(3, { latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] }, mergeable: "CONFLICTING" })] },
    });
    const gh = new GitHubClient(vi.fn() as never, undefined, graphql as never);
    const mine = await gh.getMyPullRequests();

    expect(graphql.mock.calls[0][1]).toMatchObject({ assigned: expect.stringContaining("assignee:@me"), authored: expect.stringContaining("author:@me") });
    expect(mine.assigned.map((p) => [p.number, p.review])).toEqual([[1, "pending"], [2, "changes_requested"]]);
    expect(mine.authored[0]).toMatchObject({ number: 3, projectPath: "o/r", review: "approved", ci: "success", conflicts: true, headSha: "sha" });
  });
});
