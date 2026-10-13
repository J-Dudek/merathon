import { describe, it, expect, vi } from "vitest";
import { GitLabClient, draftTitle } from "./gitlab";

function client(data: unknown) {
  const get = vi.fn().mockResolvedValue(data);
  return { gl: new GitLabClient(get as never), get };
}

const rawMR = {
  iid: 12, title: "Add feature", state: "opened", draft: false, author: { username: "alice" },
  web_url: "https://gitlab.com/owner/repo/-/merge_requests/12", created_at: "2024-01-01T00:00:00Z",
  labels: ["backend"], source_branch: "feat/x", target_branch: "main",
};

describe("GitLabClient", () => {
  it("getMergeRequests maps fields to ForgePR", async () => {
    const { gl } = client([rawMR]);
    const [mr] = await gl.getMergeRequests("owner/repo");
    expect(mr).toMatchObject({ number: 12, state: "open", author: "alice", sourceBranch: "feat/x", targetBranch: "main", labels: ["backend"] });
  });

  it("flags open merge requests with every required approval", async () => {
    const approvals: Record<string, unknown> = {
      "/projects/g%2Fp/merge_requests/1/approvals": { approved_by: [{ user: { username: "bob" } }], approvals_left: 0 },
      "/projects/g%2Fp/merge_requests/2/approvals": { approved_by: [{ user: { username: "bob" } }], approvals_left: 1 },
      "/projects/g%2Fp/merge_requests/3/approvals": { approved_by: [], approvals_left: 0 },
    };
    const get = vi.fn((path: string) => {
      if (path.startsWith("/projects/g%2Fp/merge_requests?")) return Promise.resolve([1, 2, 3, 4].map((iid) => ({ ...rawMR, iid })).concat({ ...rawMR, iid: 5, state: "merged" }));
      return path in approvals ? Promise.resolve(approvals[path]) : Promise.reject(new Error(path));
    });
    const mrs = await new GitLabClient(get as never).getMergeRequests("g/p", "all");

    expect(mrs.map((m) => m.approved)).toEqual([true, false, false, false, undefined]);
  });

  it("maps merged and closed states", async () => {
    const { gl } = client([{ ...rawMR, state: "merged" }, { ...rawMR, iid: 13, state: "closed" }]);
    const mrs = await gl.getMergeRequests("owner/repo");
    expect(mrs.map((m) => m.state)).toEqual(["merged", "closed"]);
  });

  it("getIssues maps fields to ForgeIssue", async () => {
    const { gl } = client([{ iid: 5, title: "Bug", state: "opened", author: { username: "bob" }, web_url: "u", created_at: "d", labels: ["bug"] }]);
    const [issue] = await gl.getIssues("owner/repo");
    expect(issue).toMatchObject({ number: 5, state: "open", author: "bob", labels: ["bug"] });
  });

  it("encodes path-based project IDs", async () => {
    const { gl, get } = client([]);
    await gl.getMergeRequests("group/sub/repo");
    expect(get).toHaveBeenCalledWith("/projects/group%2Fsub%2Frepo/merge_requests?state=opened&per_page=50");
  });

  it("passes numeric project IDs without encoding", async () => {
    const { gl, get } = client([]);
    await gl.getIssues("42");
    expect(get).toHaveBeenCalledWith("/projects/42/issues?state=opened&per_page=50");
  });

  it("getCurrentUser hits /user", async () => {
    const { gl, get } = client({ username: "carol" });
    expect(await gl.getCurrentUser()).toBe("carol");
    expect(get).toHaveBeenCalledWith("/user");
  });

  it("listRepos maps projects", async () => {
    const { gl } = client([{ name: "app", path_with_namespace: "team/app", http_url_to_repo: "https://gitlab.com/team/app.git", ssh_url_to_repo: "git@gitlab.com:team/app.git", visibility: "private", description: "d", last_activity_at: "2024-01-01" }]);
    const [repo] = await gl.listRepos();
    expect(repo).toMatchObject({ fullName: "team/app", cloneUrl: "https://gitlab.com/team/app.git", private: true });
  });
});

describe("GitLabClient merge request creation", () => {
  it("sends every option in the creation request, draft as a title prefix", async () => {
    const send = vi.fn().mockResolvedValue(rawMR);
    const gl = new GitLabClient(vi.fn() as never, send as never);
    const { pr } = await gl.createMergeRequest("group/app", {
      sourceBranch: "feat/x", targetBranch: "main", title: "feat: x", description: "d", draft: true,
      assignees: [{ id: 1, username: "alice", name: "Alice" }], reviewers: [{ id: 2, username: "bob", name: "Bob" }],
      labels: ["a", "b"], milestone: { id: 9, title: "v2" }, removeSourceBranch: true, squash: false,
    });
    expect(send).toHaveBeenCalledWith("POST", "/projects/group%2Fapp/merge_requests", {
      source_branch: "feat/x", target_branch: "main", title: "Draft: feat: x", description: "d",
      assignee_ids: [1], reviewer_ids: [2], labels: "a,b", milestone_id: 9, remove_source_branch: true, squash: false,
    });
    expect(pr.number).toBe(12);
  });

  it("reads project defaults for squash and source branch removal", async () => {
    const responses: Record<string, unknown> = {
      "/projects/group%2Fapp": { default_branch: "develop", squash_option: "default_on", remove_source_branch_after_merge: true },
      "/projects/group%2Fapp/members/all?per_page=100": [{ id: 1, username: "alice", name: "Alice" }, { id: 2, username: "old", state: "blocked" }],
      "/projects/group%2Fapp/labels?per_page=100": [{ name: "bug", color: "#ff0000" }],
      "/projects/group%2Fapp/milestones?state=active&per_page=100": [{ id: 4, title: "v2" }],
    };
    const get = vi.fn((path: string) => Promise.resolve(responses[path]));
    const options = await new GitLabClient(get as never).getMergeRequestOptions("group/app");
    expect(options).toEqual({
      defaultBranch: "develop",
      users: [{ id: 1, username: "alice", name: "Alice" }],
      labels: [{ name: "bug", color: "#ff0000" }],
      milestones: [{ id: 4, title: "v2" }],
      squashDefault: true,
      removeSourceBranchDefault: true,
    });
  });
});

describe("GitLabClient merge request review", () => {
  const mrPath = "/projects/group%2Fapp/merge_requests/12";
  const details = {
    ...rawMR, description: null, sha: "abc", detailed_merge_status: "mergeable", squash: false,
    force_remove_source_branch: null, head_pipeline: { id: 5, status: "running", web_url: "p" }, user: { can_merge: true },
    reviewers: [{ username: "bob", name: "Bob Martin" }], assignees: [{ username: "alice", name: "Alice Durand" }],
  };
  function detailsClient(overrides: Record<string, unknown> = {}) {
    const responses: Record<string, unknown> = {
      [mrPath]: details,
      "/projects/group%2Fapp": { default_branch: "main", squash_option: "default_on", remove_source_branch_after_merge: true },
      [`${mrPath}/approvals`]: { approved_by: [{ user: { username: "bob" } }], approvals_left: 1, user_has_approved: false },
      "/projects/group%2Fapp/pipelines/5/jobs?per_page=100": [
        { name: "build", status: "success", web_url: "b" },
        { name: "flaky", status: "failed", allow_failure: true, web_url: "f" },
        { name: "test", status: "running", web_url: "t" },
        { name: "deploy", status: "manual", web_url: "d" },
      ],
      ...overrides,
    };
    return new GitLabClient(vi.fn((path: string) => Promise.resolve(responses[path])) as never);
  }

  it("maps approvals, pipeline jobs and project merge settings", async () => {
    const d = await detailsClient().getMergeRequestDetails("group/app", 12, "bob");
    expect(d).toMatchObject({
      approvedBy: ["bob"], approvedByMe: false, approvalsLeft: 1, mergeable: true, mergeStatus: "Prête à merger",
      mergeMethods: ["merge", "squash"], defaultMergeMethod: "merge", removeSourceBranchDefault: true, description: "",
    });
    expect(d.checks.map((c) => c.status)).toEqual(["success", "skipped", "pending", "skipped"]);
    expect(d.pr).toMatchObject({ reviewers: ["bob"], assignees: ["alice"] });
    expect(d.names).toEqual({ bob: "Bob Martin", alice: "Alice Durand" });
  });

  it("offers auto-merge while the pipeline runs, unless it is already scheduled", async () => {
    const of = async (mr: Record<string, unknown>) => detailsClient({ [mrPath]: { ...details, ...mr } }).getMergeRequestDetails("group/app", 12, "me");

    expect(await of({})).toMatchObject({ mergeable: true, canAutoMerge: true, canForceMerge: false });
    expect(await of({ detailed_merge_status: "ci_still_running" })).toMatchObject({ mergeable: false, canAutoMerge: true });
    expect(await of({ head_pipeline: { id: 5, status: "success", web_url: "p" } })).toMatchObject({ mergeable: true, canAutoMerge: false });
    expect(await of({ detailed_merge_status: "not_approved" })).toMatchObject({ canAutoMerge: false });
    expect(await of({ merge_when_pipeline_succeeds: true })).toMatchObject({
      canAutoMerge: false, mergeStatus: "Auto-merge programmé : merge dès que le pipeline réussit",
    });
  });

  it("merges immediately by default, or when the pipeline succeeds on request", async () => {
    const send = vi.fn().mockResolvedValue({});
    const gl = new GitLabClient(vi.fn() as never, send as never);
    await gl.merge("group/app", 12, { method: "merge", sha: "abc", removeSourceBranch: false });
    await gl.merge("group/app", 12, { method: "merge", sha: "abc", removeSourceBranch: false, autoMerge: true });

    expect(send.mock.calls[0][2]).toEqual({ sha: "abc", squash: false, should_remove_source_branch: false });
    expect(send.mock.calls[1][2]).toEqual({ sha: "abc", squash: false, should_remove_source_branch: false, merge_when_pipeline_succeeds: true });
  });

  it("explains why a merge request cannot be merged", async () => {
    const rebase = await detailsClient({ [mrPath]: { ...details, detailed_merge_status: "need_rebase" } })
      .getMergeRequestDetails("group/app", 12, "me");
    expect(rebase).toMatchObject({ mergeable: false, canUpdateBranch: true, mergeStatus: "Rebase nécessaire sur la branche cible" });
    const noRights = await detailsClient({ [mrPath]: { ...details, user: { can_merge: false } } })
      .getMergeRequestDetails("group/app", 12, "me");
    expect(noRights).toMatchObject({ mergeable: false, mergeStatus: "Droits insuffisants pour merger" });
  });

  it("falls back to the pipeline status when jobs are unavailable", async () => {
    const responses: Record<string, unknown> = {
      [mrPath]: details, "/projects/group%2Fapp": { default_branch: "main", squash_option: "always" }, [`${mrPath}/approvals`]: {},
    };
    const get = vi.fn((path: string) => path.includes("/jobs") ? Promise.reject(new Error("403")) : Promise.resolve(responses[path]));
    const d = await new GitLabClient(get as never).getMergeRequestDetails("group/app", 12, "me");
    expect(d.checks).toEqual([{ name: "Pipeline", status: "pending", url: "p" }]);
    expect(d).toMatchObject({ mergeMethods: ["squash"], defaultMergeMethod: "squash" });
  });

  it("hides system notes", async () => {
    const gl = new GitLabClient(vi.fn().mockResolvedValue([
      { id: 1, author: { username: "bob" }, body: "added 1 commit", created_at: "d", system: true },
      { id: 2, author: { username: "bob" }, body: "LGTM", created_at: "d", system: false },
    ]) as never);
    expect(await gl.getComments("group/app", 12)).toEqual([{ id: "2", author: "bob", body: "LGTM", createdAt: "d" }]);
  });

  it("sends approval, merge, state and rebase requests", async () => {
    const send = vi.fn().mockResolvedValue(null);
    const gl = new GitLabClient(vi.fn() as never, send as never);
    await gl.review("group/app", 12, "approve", "ok");
    await gl.review("group/app", 12, "unapprove", "");
    await gl.merge("group/app", 12, { method: "squash", sha: "abc", removeSourceBranch: true });
    await gl.setState("group/app", 12, "open");
    await gl.rebase("group/app", 12);
    expect(send.mock.calls).toEqual([
      ["POST", `${mrPath}/approve`, null],
      ["POST", `${mrPath}/notes`, { body: "ok" }],
      ["POST", `${mrPath}/unapprove`, null],
      ["PUT", `${mrPath}/merge`, { sha: "abc", squash: true, should_remove_source_branch: true }],
      ["PUT", mrPath, { state_event: "reopen" }],
      ["PUT", `${mrPath}/rebase`, null],
    ]);
    await expect(gl.review("group/app", 12, "request_changes", "x")).rejects.toThrow();
  });

  it("maps list filters to GitLab states", async () => {
    const get = vi.fn().mockResolvedValue([]);
    await new GitLabClient(get as never).getMergeRequests("group/app", "merged");
    expect(get).toHaveBeenCalledWith("/projects/group%2Fapp/merge_requests?state=merged&per_page=50");
  });
});

describe("GitLab draft titles", () => {
  it("adds or removes the draft prefix without duplicating it", () => {
    expect(draftTitle("feat: x", true)).toBe("Draft: feat: x");
    expect(draftTitle("Draft: feat: x", true)).toBe("Draft: feat: x");
    expect(draftTitle("[Draft] feat: x", false)).toBe("feat: x");
    expect(draftTitle("WIP: feat: x", false)).toBe("feat: x");
    expect(draftTitle("feat: draft mode", false)).toBe("feat: draft mode");
  });

  it("setDraft rewrites the merge request title", async () => {
    const get = vi.fn().mockResolvedValue({ ...rawMR, title: "Draft: Add feature" });
    const send = vi.fn().mockResolvedValue(null);
    await new GitLabClient(get as never, send as never).setDraft("group/app", 12, false);
    expect(send).toHaveBeenCalledWith("PUT", "/projects/group%2Fapp/merge_requests/12", { title: "Add feature" });
  });
});

describe("GitLabClient inline review", () => {
  const mrPath = "/projects/group%2Fapp/merge_requests/12";
  const ctx = { headSha: "h", diffRefs: { baseSha: "b", startSha: "s", headSha: "h" } };
  const context = { path: "new.ts", oldPath: "old.ts", side: "new" as const, line: 5, oldLine: 2, newLine: 5 };
  const added = { path: "a.ts", oldPath: "a.ts", side: "new" as const, line: 4, oldLine: null, newLine: 4 };

  it("keeps only text-positioned discussions", async () => {
    const get = vi.fn().mockResolvedValue([
      { id: "d1", notes: [
        { id: 1, author: { username: "bob" }, body: "hm", created_at: "d", system: false, type: "DiffNote", resolvable: true, resolved: false,
          position: { position_type: "text", new_path: "a.ts", old_path: "a.ts", new_line: null, old_line: 3 } },
        { id: 2, author: { username: "alice" }, body: "ok", created_at: "e", system: false, type: "DiffNote", resolvable: true, resolved: false },
      ] },
      { id: "d2", notes: [{ id: 3, author: null, body: "general", created_at: "d", system: false }] },
    ]);
    const threads = await new GitLabClient(get as never).getReviewThreads("group/app", 12);
    expect(get).toHaveBeenCalledWith(`${mrPath}/discussions?per_page=100`);
    expect(threads).toEqual([{
      id: "d1", replyTo: "d1", path: "a.ts", side: "old", line: 3, resolved: false,
      comments: [{ id: "1", author: "bob", body: "hm", createdAt: "d" }, { id: "2", author: "alice", body: "ok", createdAt: "e" }],
    }]);
  });

  it("positions comments with diff refs, both line numbers for unchanged lines", async () => {
    const send = vi.fn().mockResolvedValue(null);
    const gl = new GitLabClient(vi.fn() as never, send as never);
    await gl.addLineComment("group/app", 12, ctx, context, "nit");
    await gl.addLineComment("group/app", 12, ctx, added, "new");
    const position = { position_type: "text", base_sha: "b", start_sha: "s", head_sha: "h" };
    expect(send.mock.calls).toEqual([
      ["POST", `${mrPath}/discussions`, { body: "nit", position: { ...position, old_path: "old.ts", new_path: "new.ts", new_line: 5, old_line: 2 } }],
      ["POST", `${mrPath}/discussions`, { body: "new", position: { ...position, old_path: "a.ts", new_path: "a.ts", new_line: 4 } }],
    ]);
    await expect(gl.addLineComment("group/app", 12, { headSha: "h", diffRefs: null }, added, "x")).rejects.toThrow();
  });

  it("replies to and resolves discussions", async () => {
    const send = vi.fn().mockResolvedValue(null);
    const gl = new GitLabClient(vi.fn() as never, send as never);
    await gl.replyToThread("group/app", 12, "d1", "done");
    await gl.resolveThread("group/app", 12, "d1", true);
    expect(send.mock.calls).toEqual([
      ["POST", `${mrPath}/discussions/d1/notes`, { body: "done" }],
      ["PUT", `${mrPath}/discussions/d1`, { resolved: true }],
    ]);
  });

  it("publishes a review comment by comment and keeps going after a failure", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("line not in diff"))
      .mockResolvedValue(null);
    const gl = new GitLabClient(vi.fn() as never, send as never);
    const result = await gl.submitReview("group/app", 12, ctx, {
      verdict: "approve", body: "LGTM",
      comments: [{ id: "x", position: added, body: "a" }, { id: "y", position: context, body: "b" }],
    });
    expect(result.publishedIds).toEqual(["y"]);
    expect(result.errors).toEqual(["a.ts:4 : line not in diff"]);
    expect(send.mock.calls.slice(2)).toEqual([
      ["POST", `${mrPath}/notes`, { body: "LGTM" }],
      ["POST", `${mrPath}/approve`, null],
    ]);
  });

  it("excludes line comments from the conversation", async () => {
    const gl = new GitLabClient(vi.fn().mockResolvedValue([
      { id: 1, author: { username: "bob" }, body: "inline", created_at: "d", system: false, type: "DiffNote" },
      { id: 2, author: { username: "bob" }, body: "general", created_at: "d", system: false, type: null },
    ]) as never);
    expect((await gl.getComments("group/app", 12)).map((c) => c.body)).toEqual(["general"]);
  });

  it("getMergeRequestTemplates picks the « Default » template, or the project setting first", async () => {
    const responses = (projectTemplate: string | null) => (path: string) => {
      if (path === "/projects/g%2Fp/templates/merge_requests") return Promise.resolve([{ key: "Default", name: "Default" }, { key: "Bug", name: "Bug" }]);
      if (path.startsWith("/projects/g%2Fp/templates/merge_requests/")) return Promise.resolve({ content: `# ${path.split("/").pop()}` });
      if (path === "/projects/g%2Fp") return Promise.resolve({ merge_requests_template: projectTemplate });
      return Promise.reject(new Error(path));
    };
    const plain = await new GitLabClient(vi.fn(responses(null)) as never).getMergeRequestTemplates("g/p");
    expect(plain).toEqual({ templates: [{ name: "Default", content: "# Default" }, { name: "Bug", content: "# Bug" }], defaultName: "Default" });

    const premium = await new GitLabClient(vi.fn(responses("Réglage")) as never).getMergeRequestTemplates("g/p");
    expect(premium.defaultName).toBe("Modèle du projet");
    expect(premium.templates[0]).toEqual({ name: "Modèle du projet", content: "Réglage" });
  });

  it("getMyMergeRequests lists MRs of every project, with pipeline and approvals for mine", async () => {
    const mr = (iid: number, extra: Record<string, unknown> = {}) => ({
      iid, title: `MR ${iid}`, state: "opened", project_id: 9, references: { full: "grp/proj!" + iid }, ...extra,
    });
    const get = vi.fn((path: string) => {
      if (path.startsWith("/merge_requests?scope=assigned_to_me")) return Promise.resolve([mr(1)]);
      if (path.startsWith("/merge_requests?scope=all&reviewer_username=me")) return Promise.resolve([mr(1), mr(2)]);
      if (path.startsWith("/merge_requests?scope=created_by_me")) return Promise.resolve([mr(3)]);
      if (path === "/projects/9/merge_requests/3") return Promise.resolve(mr(3, { head_pipeline: { id: 1, status: "failed", web_url: "" }, has_conflicts: false }));
      if (path === "/projects/9/merge_requests/2/approvals") return Promise.resolve({ approved_by: [{ user: { username: "bob" } }], approvals_left: 0 });
      if (path === "/projects/9/merge_requests/3/approvals") return Promise.resolve({ approved_by: [{ user: { username: "bob" } }], approvals_left: 0 });
      return Promise.reject(new Error(path));
    });
    const mine = await new GitLabClient(get as never).getMyMergeRequests("me");

    expect(mine.assigned.map((m) => [m.projectPath, m.number, m.review])).toEqual([["grp/proj", 1, "pending"], ["grp/proj", 2, "approved"]]);
    expect(mine.authored[0]).toMatchObject({ number: 3, projectPath: "grp/proj", review: "approved", ci: "failure", conflicts: false });
  });
});
