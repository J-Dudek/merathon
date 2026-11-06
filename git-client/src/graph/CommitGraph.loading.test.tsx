import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitGraph } from "./CommitGraph";
import { emptyRepo, useRepoStore } from "../store/useRepoStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

describe("CommitGraph without commits", () => {
  afterEach(() => useRepoStore.setState(emptyRepo));

  it("says it is loading until the repository has been read", () => {
    useRepoStore.setState({ ...emptyRepo, repoPath: "/repo", loaded: false });
    render(<CommitGraph />);
    expect(screen.getByText("Chargement…")).toBeTruthy();
    expect(screen.queryByText(/Aucun commit/)).toBeNull();
  });

  it("says the repository is empty once it has been read", () => {
    useRepoStore.setState({ ...emptyRepo, repoPath: "/repo", loaded: true });
    render(<CommitGraph />);
    expect(screen.getByText(/Aucun commit/)).toBeTruthy();
  });
});
