import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Toolbar } from "./Toolbar";
import { useRepoStore } from "../store/useRepoStore";
import type { BranchInfo, RepoInfo, StashInfo } from "../types/git";

function setUserAgent(value: string) {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}

const info = { path: "/data/repos/site", head_branch: "main", head_detached: false, head_hash: "abc", state: "clean", pending_message: null, interactive_rebase: null } as unknown as RepoInfo;
const head: BranchInfo = { name: "main", is_remote: false, target_hash: "abc", is_head: true, upstream: "origin/main", ahead: 2, behind: 0 };

describe("Barre d'outils sur téléphone", () => {
  const original = navigator.userAgent;
  beforeEach(() => {
    setUserAgent("Mozilla/5.0 (Linux; Android 16)");
    useRepoStore.setState({ repoPath: "/data/repos/site", info, branches: [head], stashes: [{ index: 0 } as unknown as StashInfo] });
  });
  afterEach(() => setUserAgent(original));

  it("met Pull, Push et Fetch sur la ligne du dépôt, le reste dans « ⋯ »", () => {
    render(<Toolbar onClone={() => {}} onAccounts={() => {}} />);
    const header = screen.getByRole("banner");
    expect(within(header).getByText("site")).toBeTruthy();
    expect(within(header).getByRole("button", { name: /^Push/ }).textContent).toContain("2");
    expect(within(header).getByRole("button", { name: /^Pull/ })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Fetch" })).toBeTruthy();
    expect(within(header).queryByRole("button", { name: "Stash" })).toBeNull();
    expect(within(header).queryByRole("button", { name: "Branche" })).toBeNull();

    fireEvent.click(within(header).getByRole("button", { name: /^Autres actions/ }));
    for (const item of ["Pull (rebase)", "Push forcé…", "Nouvelle branche…", "Stash", "Pop (1 stash)", "Synchroniser les dépôts ouverts"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(`^${item.replace(/[()…]/g, "\\$&")}`) })).toBeTruthy();
    }
  });

  it("garde la barre complète sur le bureau", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    render(<Toolbar onClone={() => {}} onAccounts={() => {}} />);
    expect(screen.getByRole("button", { name: "Stash" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Autres actions/ })).toBeNull();
  });
});
