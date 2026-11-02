import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const remotesOf: Record<string, { name: string; url: string }[]> = {
  "/app": [{ name: "origin", url: "git@github.com:me/app.git" }, { name: "upstream", url: "https://github.com/Org/App.git" }],
  "/other": [{ name: "origin", url: "git@github.com:me/other.git" }],
};

vi.mock("../ipc/commands", () => ({
  listRemotes: vi.fn(async (path: string) => remotesOf[path] ?? []),
}));

const { TabBar } = await import("./TabBar");
const { publishMyPullRequests } = await import("../lib/myPullRequests");
const { useAccountsStore } = await import("../store/useAccountsStore");
const { useDisplayStore } = await import("../store/useDisplayStore");
const { useRepoStore } = await import("../store/useRepoStore");
const { seenKey, useSeenPrsStore } = await import("../store/useSeenPrsStore");
const { useTabsStore } = await import("../store/useTabsStore");
import type { ForgeAccount, PrSummary } from "../types/forge";

const account = { id: "a", provider: "github", base_url: "https://github.com", label: "moi" } as ForgeAccount;
const pr = { number: 7, projectPath: "org/app", headSha: "h", updatedAt: "2026-01-02" } as PrSummary;

const flush = () => act(async () => { await new Promise((r) => setTimeout(r)); });
const tab = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  useAccountsStore.setState({ accounts: [account] });
  useSeenPrsStore.setState({ seen: {} });
  useDisplayStore.setState((s) => ({ notifications: { ...s.notifications, enabled: true } }));
  useTabsStore.setState({ tabs: [{ id: 1, path: "/app" }, { id: 2, path: "/other" }], activeId: 2 });
  useRepoStore.setState({ repoPath: "/other" });
  publishMyPullRequests(account.id, { assigned: [pr], authored: [] });
});

describe("TabBar", () => {
  it("signale l'onglet du dépôt qui a de l'activité, par n'importe lequel de ses remotes", async () => {
    render(<TabBar />);
    await flush();
    expect(tab(/^app/).textContent).toBe("app (1 PR / MR avec du nouveau)");
    expect(tab(/^other/).textContent).toBe("other");
  });

  it("retire le signal une fois la PR consultée", async () => {
    render(<TabBar />);
    await flush();
    act(() => useSeenPrsStore.getState().markSeen(seenKey(account.id, pr.projectPath, pr.number), pr));
    expect(tab(/^app/).textContent).toBe("app");
  });

  it("suit les nouvelles listes de PR", async () => {
    render(<TabBar />);
    await flush();
    act(() => publishMyPullRequests(account.id, { assigned: [], authored: [] }));
    await flush();
    expect(tab(/^app/).textContent).toBe("app");
  });

  it("ne signale rien si les notifications sont désactivées", async () => {
    useDisplayStore.setState((s) => ({ notifications: { ...s.notifications, enabled: false } }));
    render(<TabBar />);
    await flush();
    expect(tab(/^app/).textContent).toBe("app");
  });
});
