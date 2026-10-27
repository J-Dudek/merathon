import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PullRequestDialog } from "./PullRequestDialog";
import type { ForgeAccount, ForgeIssue } from "../types/forge";

const forge = vi.hoisted(() => ({
  getPullRequestOptions: vi.fn(),
  getPullRequestTemplates: vi.fn(),
  getIssues: vi.fn(),
  searchIssues: vi.fn(),
}));
vi.mock("../api/forge", () => ({ forgeClient: () => forge }));
vi.mock("../ipc/commands", () => ({ push: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const account: ForgeAccount = { id: "acc", provider: "github", label: "a", base_url: "https://github.com", username: "me", auth: "pat" };
const issue = (number: number, title: string, state: ForgeIssue["state"] = "open"): ForgeIssue =>
  ({ number, title, state, author: "", url: "", createdAt: "", labels: [] });

function renderDialog(sourceBranch: string) {
  render(<PullRequestDialog target={{ account, projectPath: "o/r", remoteName: "origin", sourceBranch }} onClose={() => {}} />);
  return screen.getByLabelText("Description") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  forge.getPullRequestOptions.mockResolvedValue({
    defaultBranch: "main", users: [], labels: [], milestones: [], squashDefault: false, removeSourceBranchDefault: false,
  });
  forge.getPullRequestTemplates.mockResolvedValue({ templates: [], defaultName: null });
  forge.getIssues.mockResolvedValue([issue(12, "Crash au démarrage")]);
  forge.searchIssues.mockResolvedValue([]);
});

describe("PullRequestDialog : issue de la branche", () => {
  it("propose de fermer au merge l'issue évoquée par la branche, puis s'efface", async () => {
    const box = renderDialog("fix/12-crash");
    fireEvent.click(await screen.findByRole("button", { name: "Fermer au merge" }));
    expect(box.value).toBe("Closes #12\n");
    expect(screen.queryByRole("button", { name: "Fermer au merge" })).toBeNull();
    expect(forge.searchIssues).not.toHaveBeenCalled();
  });

  it("cherche par son numéro une issue absente des issues chargées, et ignore une issue fermée", async () => {
    forge.searchIssues.mockResolvedValue([issue(40, "Ancienne", "closed")]);
    renderDialog("feat/40-old");
    await waitFor(() => expect(forge.searchIssues).toHaveBeenCalledWith("o/r", "40"));
    expect(screen.queryByRole("button", { name: "Fermer au merge" })).toBeNull();
  });

  it("se masque si la description ferme déjà l'issue ou si on l'ignore", async () => {
    const box = renderDialog("12-crash");
    await screen.findByRole("button", { name: "Fermer au merge" });
    fireEvent.change(box, { target: { value: "Fixes #12" } });
    expect(screen.queryByRole("button", { name: "Fermer au merge" })).toBeNull();
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Ignorer la suggestion d'issue" }));
    expect(screen.queryByRole("button", { name: "Fermer au merge" })).toBeNull();
  });

  it("ne propose rien pour une branche sans numéro", async () => {
    renderDialog("feat/login");
    await waitFor(() => expect(forge.getIssues).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Fermer au merge" })).toBeNull();
    expect(forge.searchIssues).not.toHaveBeenCalled();
  });
});
