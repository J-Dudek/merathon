import { describe, it, expect } from "vitest";
import { hostOf, instanceUrl, newPullRequestUrl, parseRemoteUrl, remoteForAccount } from "./remoteUrl";
import type { ForgeAccount } from "../types/forge";

const gitlabCorp: ForgeAccount = {
  id: "1", provider: "gitlab", label: "corp", base_url: "https://git.corp.io", username: "alice", auth: "pat",
};
const github: ForgeAccount = {
  id: "2", provider: "github", label: "gh", base_url: "https://github.com", username: "alice", auth: "pat",
};

describe("parseRemoteUrl", () => {
  it("parses https remotes", () => {
    expect(parseRemoteUrl("https://github.com/owner/repo.git")).toEqual({ host: "github.com", path: "owner/repo" });
    expect(parseRemoteUrl("https://user@GitLab.com/group/sub/repo")).toEqual({ host: "gitlab.com", path: "group/sub/repo" });
  });

  it("parses scp-like and ssh:// remotes", () => {
    expect(parseRemoteUrl("git@github.com:owner/repo.git")).toEqual({ host: "github.com", path: "owner/repo" });
    expect(parseRemoteUrl("ssh://git@git.corp.io:2222/team/app.git")).toEqual({ host: "git.corp.io", path: "team/app" });
    expect(parseRemoteUrl("git@github.com:/owner/repo.git")).toEqual({ host: "github.com", path: "owner/repo" });
  });

  it("rejects local paths", () => {
    expect(parseRemoteUrl("/srv/git/repo.git")).toBeNull();
  });
});

describe("remoteForAccount", () => {
  const remotes = [
    { name: "fork", url: "https://github.com/alice/repo.git" },
    { name: "origin", url: "git@github.com:upstream/repo.git" },
    { name: "corp", url: "https://git.corp.io/team/app.git" },
  ];

  it("prefers origin among remotes on the account host", () => {
    expect(remoteForAccount(remotes, github)?.path).toBe("upstream/repo");
  });

  it("prefers the requested remote when it is on the account host", () => {
    expect(remoteForAccount(remotes, github, "fork")?.path).toBe("alice/repo");
    expect(remoteForAccount(remotes, github, "corp")?.remote.name).toBe("origin");
  });

  it("matches self-hosted instances by host", () => {
    expect(remoteForAccount(remotes, gitlabCorp)?.remote.name).toBe("corp");
  });

  it("returns null when no remote matches", () => {
    expect(remoteForAccount([remotes[2]], github)).toBeNull();
  });
});

describe("newPullRequestUrl", () => {
  it("builds GitHub compare and GitLab MR links", () => {
    expect(newPullRequestUrl(github, "o/r", "feat/x")).toBe("https://github.com/o/r/compare/feat%2Fx?expand=1");
    expect(newPullRequestUrl(gitlabCorp, "team/app", "fix")).toBe(
      "https://git.corp.io/team/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix",
    );
  });

  it("hostOf handles invalid URLs", () => {
    expect(hostOf("https://GitLab.com/")).toBe("gitlab.com");
    expect(hostOf("nope")).toBeNull();
  });
});

describe("instanceUrl", () => {
  it("normalizes what the user types", () => {
    expect(instanceUrl("https://gitlab.corp.io")).toBe("https://gitlab.corp.io");
    expect(instanceUrl("  https://GitLab.corp.io/ ")).toBe("https://gitlab.corp.io");
    expect(instanceUrl("gitlab.corp.io")).toBe("https://gitlab.corp.io");
    expect(instanceUrl("https://https://gitlab.corp.io")).toBe("https://gitlab.corp.io");
    expect(instanceUrl("https://gitlab.corp.io/group/project/-/tree/main")).toBe("https://gitlab.corp.io");
    expect(instanceUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("is null while the host is incomplete", () => {
    expect(instanceUrl("")).toBeNull();
    expect(instanceUrl("https://")).toBeNull();
    expect(instanceUrl("https://gitlab")).toBeNull();
  });
});
