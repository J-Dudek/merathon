import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PullRequestReviewDialog } from "./PullRequestReviewDialog";
import { useUiStore } from "../store/useUiStore";
import type { ForgeAccount, ForgePR, PullRequestDetails } from "../types/forge";

const forge = vi.hoisted(() => ({
  getPullRequestDetails: vi.fn(),
  getComments: vi.fn(),
  updatePullRequest: vi.fn(),
  getPullRequestOptions: vi.fn(),
  setPeople: vi.fn(),
  getBranches: vi.fn(),
  setTargetBranch: vi.fn(),
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
  forge.setPeople.mockResolvedValue(undefined);
  forge.getBranches.mockResolvedValue(["main", "develop", "feature/newsletter"]);
  forge.setTargetBranch.mockResolvedValue(undefined);
  forge.getPullRequestOptions.mockResolvedValue({
    defaultBranch: "main", labels: [], milestones: [], squashDefault: false, removeSourceBranchDefault: false,
    users: [
      { id: 1, username: "camille", name: "Camille" },
      { id: 2, username: "lucas", name: "Lucas" },
      { id: 3, username: "ines", name: "Inès" },
    ],
  });
});

describe("PullRequestReviewDialog : relecteurs et assignés", () => {
  const peopleButton = () => screen.queryByRole("button", { name: /Modifier les personnes/ });

  it("n'est modifiable que sur une PR ouverte", async () => {
    forge.getPullRequestDetails.mockResolvedValue(details({ state: "merged" }));
    renderDialog();
    await screen.findByText("Bloc dans le pied de page.");
    expect(peopleButton()).toBeNull();
  });

  it("remplace relecteurs et assignés, puis recharge le détail et la liste", async () => {
    forge.getPullRequestDetails.mockResolvedValue(details({ reviewers: ["lucas"], assignees: ["camille"] }));
    const { onChanged } = renderDialog(gitlab);
    fireEvent.click(await screen.findByRole("button", { name: /Modifier les personnes/ }));
    await waitFor(() => expect(forge.getPullRequestOptions).toHaveBeenCalledWith("o/r"));

    fireEvent.click(screen.getByRole("button", { name: "Retirer lucas" }));
    const add = await screen.findByRole("combobox", { name: /Relecteurs : ajouter/ });
    fireEvent.change(add, { target: { value: "Inès" } });
    fireEvent.click(screen.getByRole("option", { name: /Inès/ }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer camille" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(forge.setPeople).toHaveBeenCalledWith("o/r", 13, {
      reviewers: [{ id: 3, username: "ines", name: "Inès" }],
      assignees: [],
    }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  });

  it("GitHub : l'auteur n'est pas proposé en relecteur", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Modifier les personnes/ }));
    const add = await screen.findByRole("combobox", { name: /Relecteurs demandés : ajouter/ });
    await waitFor(() => expect((add as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(add, { target: { value: "a" } });
    expect(screen.queryByRole("option", { name: /Camille/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Lucas/ })).toBeTruthy();
  });
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

describe("PullRequestReviewDialog : branche cible", () => {
  it("n'est modifiable que sur une PR ouverte", async () => {
    forge.getPullRequestDetails.mockResolvedValue(details({ state: "closed" }));
    renderDialog();
    await screen.findByText("Bloc dans le pied de page.");
    expect(screen.queryByRole("button", { name: "Changer la branche cible" })).toBeNull();
  });

  it("propose les branches sauf la source, puis enregistre la nouvelle cible", async () => {
    const { onChanged } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Changer la branche cible" }));
    const select = screen.getByRole("combobox", { name: "Branche cible" }) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect([...select.options].map((o) => o.value)).toEqual(["develop", "main"]);

    fireEvent.change(select, { target: { value: "develop" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(forge.setTargetBranch).toHaveBeenCalledWith("o/r", 13, "develop"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("n'appelle pas la forge si la cible ne change pas", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Changer la branche cible" }));
    await waitFor(() => expect(forge.getBranches).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Branche cible" })).toBeNull());
    expect(forge.setTargetBranch).not.toHaveBeenCalled();
  });
});
