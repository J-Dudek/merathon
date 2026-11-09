// Diff de la copie de travail : rechargé à chaque relecture du statut, même quand le statut ne change pas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { FileDiff } from "../types/git";

const getDiff = vi.fn<(repo: string, path: string, staged: boolean) => Promise<FileDiff>>();
vi.mock("../ipc/commands", () => ({ getDiff, applyLines: vi.fn(), getCommitFileDiff: vi.fn(), getCompareFileDiff: vi.fn() }));

const { CenterDiff } = await import("./CenterDiff");
const { useRepoStore } = await import("../store/useRepoStore");

const diffOf = (content: string): FileDiff => ({
  path: "a.txt",
  is_binary: false,
  hunks: [{ header: "@@ -1 +1 @@", old_start: 1, new_start: 1, lines: [{ kind: "added", content, old_lineno: null, new_lineno: 1 }] }],
});

describe("CenterDiff", () => {
  afterEach(() => vi.clearAllMocks());

  it("affiche la nouvelle version d'un fichier déjà modifié quand le statut est relu", async () => {
    useRepoStore.setState({ repoPath: "/repo", status: [{ path: "a.txt", status: "modified", staged: false }], workdirVersion: 0 });
    getDiff.mockResolvedValueOnce(diffOf("première version"));
    render(<CenterDiff view={{ kind: "diff", path: "a.txt", source: { type: "workdir", staged: false } }} />);
    expect(await screen.findByText("première version")).toBeTruthy();

    // Le fichier est encore modifié : le statut est identique, seul le compteur de relecture change.
    getDiff.mockResolvedValueOnce(diffOf("deuxième version"));
    await act(async () => useRepoStore.setState({ status: [{ path: "a.txt", status: "modified", staged: false }], workdirVersion: 1 }));
    expect(await screen.findByText("deuxième version")).toBeTruthy();
    expect(getDiff).toHaveBeenCalledTimes(2);
  });
});
