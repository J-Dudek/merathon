import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PullRequestReviewDialog } from "./PullRequestReviewDialog";
import { useUiStore } from "../store/useUiStore";
import type { ForgeAccount, ForgePR, PullRequestDetails } from "../types/forge";

const forge = vi.hoisted(() => ({
  getPullRequestDetails: vi.fn(),
  getComments: vi.fn(),
  updatePullRequest: vi.fn(),
  getIssues: vi.fn(),
  searchIssues: vi.fn(),
}));
vi.mock("../api/forge", () => ({ forgeClient: () => forge }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const github: ForgeAccount = { id: "acc", provider: "github", label: "a", base_url: "https://github.com", username: "camille", auth: "pat" };
const gitlab: ForgeAccount = { ...github, provider: "gitlab", base_url: "https://gitlab.com" };

const pr = (over: Partial<ForgePR> = {}): ForgePR => ({
  number: 13, title: "Inscription à la newsletter", state: "open", author: "camille", url: "", createdAt: "", updatedAt: "",
  headSha: "h", draft: false, labels: [], sourceBranch: "feature/newsletter", targetBranch: "main", reviewers: [], assignees: [],
  ...over,
});

const details = (over: Partial<ForgePR> = {}, description = "Bloc dans le pied de page."): PullRequestDetails => ({
  pr: pr(over), description, headSha: "h", approvedBy: [], changesRequestedBy: [], approvedByMe: false, names: {}, approvalsLeft: null, checks: [],
  mergeable: false, mergeStatus: "", canForceMerge: false, canAutoMerge: false, canUpdateBranch: false, mergeMethods: ["merge"],
  defaultMergeMethod: "merge", removeSourceBranchDefault: false, diffRefs: null,
});

function renderDialog(account = github, onChanged = vi.fn(), onClose = vi.fn()) {
  render(<PullRequestReviewDialog account={account} projectPath="o/r" remoteName={null} number={13} onChanged={onChanged} onClose={onClose} />);
  return { onChanged, onClose };
}

const editButton = () => screen.queryByRole("button", { name: /^Modifier$/ });

beforeEach(() => {
  vi.clearAllMocks();
  forge.getPullRequestDetails.mockResolvedValue(details());
  forge.getComments.mockResolvedValue([]);
  forge.updatePullRequest.mockResolvedValue(undefined);
  forge.getIssues.mockResolvedValue([]);
  forge.searchIssues.mockResolvedValue([]);
});

describe("PullRequestReviewDialog : modification par l'auteur", () => {
  it("n'est proposée qu'à l'auteur de la PR", async () => {
    forge.getPullRequestDetails.mockResolvedValue(details({ author: "lucas" }));
    renderDialog();
    await screen.findByText("Bloc dans le pied de page.");
    expect(editButton()).toBeNull();
  });

  it("enregistre le titre et la description, puis recharge le détail et la liste", async () => {
    const { onChanged } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /^Modifier$/ }));
    const title = screen.getByRole("textbox", { name: "Titre" }) as HTMLInputElement;
    const body = screen.getByLabelText("Description (Markdown)") as HTMLTextAreaElement;
    expect(title.value).toBe("Inscription à la newsletter");
    expect(body.value).toBe("Bloc dans le pied de page.");
    expect(forge.getIssues).toHaveBeenCalledWith("o/r");

    fireEvent.change(title, { target: { value: "  Newsletter dans le pied de page  " } });
    fireEvent.change(body, { target: { value: "Closes #8" } });
    forge.getPullRequestDetails.mockResolvedValue(details({ title: "Newsletter dans le pied de page" }, "Closes #8"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await screen.findByText("Closes #8");
    expect(forge.updatePullRequest).toHaveBeenCalledWith("o/r", 13, { title: "Newsletter dans le pied de page", description: "Closes #8" });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Titre" })).toBeNull();
  });

  it("refuse un titre vide et enregistre avec Ctrl+Entrée", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /^Modifier$/ }));
    const title = screen.getByRole("textbox", { name: "Titre" });
    fireEvent.change(title, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
    expect(forge.updatePullRequest).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "Titre court" } });
    fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(forge.updatePullRequest).toHaveBeenCalledWith("o/r", 13, { title: "Titre court", description: "Bloc dans le pied de page." }));
  });

  it("garde le formulaire ouvert si la forge refuse", async () => {
    forge.updatePullRequest.mockRejectedValue("403 : droits insuffisants");
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /^Modifier$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(forge.updatePullRequest).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Titre" })).toBeTruthy();
  });

  it("GitLab : modifie le titre sans le préfixe de brouillon", async () => {
    forge.getPullRequestDetails.mockResolvedValue(details({ title: "Draft: Pagination", draft: true }));
    renderDialog(gitlab);
    fireEvent.click(await screen.findByRole("button", { name: /^Modifier$/ }));
    expect((screen.getByRole("textbox", { name: "Titre" }) as HTMLInputElement).value).toBe("Pagination");
  });

  it("demande confirmation avant de fermer avec des modifications non enregistrées", async () => {
    const { onClose } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /^Modifier$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Titre" }), { target: { value: "Autre titre" } });
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(useUiStore.getState().dialog?.title).toBe("Abandonner les modifications ?"));
    expect(onClose).not.toHaveBeenCalled();
    useUiStore.getState().dialog?.resolve(null);
  });
});
