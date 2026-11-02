import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInfo } from "../types/git";

vi.mock("../ipc/commands", () => ({
  getStatus: vi.fn(async () => []),
  removeWorktree: vi.fn(async () => {}),
  addWorktree: vi.fn(async () => {}),
}));

const { defaultWorktreePath, deleteWorktree, removalMessage } = await import("./worktrees");
const { useRepoStore } = await import("../store/useRepoStore");
const { useUiStore } = await import("../store/useUiStore");
const commands = await import("../ipc/commands");

const worktree = (patch: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  name: "wt", path: "/src/wt", branch: "feat", head_hash: "abc", is_main: false, is_current: false, locked: false, valid: true, ...patch,
});

describe("defaultWorktreePath", () => {
  it("place le worktree à côté du dépôt, sans sous-dossier pour les branches à préfixe", () => {
    expect(defaultWorktreePath("/src/app/", "feat/login")).toBe("/src/app-feat-login");
    expect(defaultWorktreePath("C:\\src\\app", "fix")).toBe("C:\\src\\app-fix");
  });
});

describe("removalMessage", () => {
  it("prévient des modifications perdues et de la branche conservée", () => {
    expect(removalMessage(worktree(), 0)).toBe("Le dossier /src/wt et tout son contenu seront supprimés. La branche feat est conservée.");
    expect(removalMessage(worktree(), 1)).toContain("1 fichier modifié ou non suivi sera définitivement perdu.");
    expect(removalMessage(worktree(), 3)).toContain("3 fichiers modifiés ou non suivis seront définitivement perdus.");
  });

  it("ne parle que de la référence si le dossier a disparu", () => {
    expect(removalMessage(worktree({ valid: false }), 0)).toContain("seule sa référence");
  });
});

describe("deleteWorktree", () => {
  const answer = (confirmed: boolean) => useUiStore.setState({ ask: async () => (confirmed ? { value: "", checked: false } : null) });
  const recents = () => useRepoStore.getState().recentRepos;

  beforeEach(() => {
    vi.clearAllMocks();
    // Sans rafraîchissement : seul le retrait des récents est testé ici.
    useRepoStore.setState({ repoPath: "/src/app", recentRepos: ["/src/wt/", "/src/app"], refresh: async () => {} });
  });

  it("retire le dossier supprimé des dépôts récents", async () => {
    answer(true);
    await deleteWorktree(worktree());
    expect(commands.removeWorktree).toHaveBeenCalledWith("/src/app", "wt");
    expect(recents()).toEqual(["/src/app"]);
  });

  it("garde les récents si la suppression est annulée ou échoue", async () => {
    answer(false);
    await deleteWorktree(worktree());
    expect(commands.removeWorktree).not.toHaveBeenCalled();
    expect(recents()).toHaveLength(2);

    answer(true);
    vi.mocked(commands.removeWorktree).mockRejectedValueOnce(new Error("verrouillé"));
    await deleteWorktree(worktree());
    expect(recents()).toHaveLength(2);
  });
});
