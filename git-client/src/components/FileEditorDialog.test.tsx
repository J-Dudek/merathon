// Éditeur des fichiers du dépôt : sur Android, aucun autre éditeur n'accède au dossier privé des dépôts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../ipc/commands", () => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const { FileEditorDialog, filterFiles } = await import("./FileEditorDialog");
const { useUiStore } = await import("../store/useUiStore");
const { useRepoStore } = await import("../store/useRepoStore");
const commands = vi.mocked(await import("../ipc/commands"));

const REPO = "/data/data/fr.byj6n.merathon/repos/site";

/** Répond à la fenêtre de confirmation ou de saisie ouverte par `ask`. */
async function answer(value: string | null) {
  await waitFor(() => expect(useUiStore.getState().dialog).not.toBeNull());
  useUiStore.getState().closeDialog(value === null ? null : { value, checked: false });
}

describe("FileEditorDialog", () => {
  const refreshStatus = vi.fn(async () => {});

  beforeEach(() => {
    commands.listFiles.mockResolvedValue(["README.md", "src/app.js", "src/style.css"]);
    commands.readFile.mockResolvedValue("# Site\n");
    commands.writeFile.mockResolvedValue();
    commands.deleteFile.mockResolvedValue();
    useRepoStore.setState({ refreshStatus });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ dialog: null, toasts: [] });
  });

  it("filtre les fichiers sur tous les mots, sans tenir compte de la casse", () => {
    const files = ["README.md", "src/app.js", "src/style.css"];
    expect(filterFiles(files, "")).toEqual(files);
    expect(filterFiles(files, "SRC css")).toEqual(["src/style.css"]);
    expect(filterFiles(files, "absent")).toEqual([]);
  });

  it("ouvre un fichier, enregistre la modification et rafraîchit l'état du dépôt", async () => {
    render(<FileEditorDialog repoPath={REPO} onClose={() => {}} />);
    fireEvent.click(await screen.findByTitle("README.md"));
    const editor = await screen.findByLabelText("Contenu de README.md");
    expect((editor as HTMLTextAreaElement).value).toBe("# Site\n");
    expect(screen.getByRole("button", { name: "Enregistrer" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(editor, { target: { value: "# Site de l'atelier\n" } });
    expect(screen.getByText("Modifié, non enregistré")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(commands.writeFile).toHaveBeenCalledWith(REPO, "README.md", "# Site de l'atelier\n", false));
    await waitFor(() => expect(screen.getByText("Enregistré")).toBeTruthy());
    expect(refreshStatus).toHaveBeenCalled();
  });

  it("crée un nouveau fichier à l'emplacement saisi", async () => {
    render(<FileEditorDialog repoPath={REPO} onClose={() => {}} />);
    await screen.findByTitle("README.md");
    fireEvent.click(screen.getByRole("button", { name: "Nouveau fichier" }));
    await answer("./docs/notes.md");

    const editor = await screen.findByLabelText("Contenu de docs/notes.md");
    fireEvent.change(editor, { target: { value: "Notes\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(commands.writeFile).toHaveBeenCalledWith(REPO, "docs/notes.md", "Notes\n", true));
    expect(commands.listFiles).toHaveBeenCalledTimes(2);
  });

  it("demande confirmation avant de perdre des modifications, et avant de supprimer", async () => {
    const onClose = vi.fn();
    render(<FileEditorDialog repoPath={REPO} initialFile="src/app.js" onClose={onClose} />);
    const editor = await screen.findByLabelText("Contenu de src/app.js");
    fireEvent.change(editor, { target: { value: "modifié" } });

    fireEvent.click(screen.getByRole("button", { name: /Fichiers/ }));
    await answer(null);
    expect(screen.getByLabelText("Contenu de src/app.js")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Supprimer/ }));
    await answer("");
    await waitFor(() => expect(commands.deleteFile).toHaveBeenCalledWith(REPO, "src/app.js"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("× ferme l'éditeur même avec un fichier ouvert, après confirmation s'il est modifié", async () => {
    const onClose = vi.fn();
    render(<FileEditorDialog repoPath={REPO} initialFile="src/app.js" onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText("Contenu de src/app.js"), { target: { value: "modifié" } });
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await answer("");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Retour d'Android (Échap) sur un fichier revient à la liste, puis ferme", async () => {
    const onClose = vi.fn();
    render(<FileEditorDialog repoPath={REPO} initialFile="src/app.js" onClose={onClose} />);
    await screen.findByLabelText("Contenu de src/app.js");
    fireEvent.keyDown(document, { key: "Escape" });
    await screen.findByTitle("README.md");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("affiche l'erreur d'un fichier qui ne peut pas être modifié", async () => {
    commands.readFile.mockRejectedValue("logo.png est un fichier binaire : il ne peut pas être modifié ici");
    commands.listFiles.mockResolvedValue(["logo.png"]);
    render(<FileEditorDialog repoPath={REPO} onClose={() => {}} />);
    fireEvent.click(await screen.findByTitle("logo.png"));
    expect((await screen.findByRole("alert")).textContent).toContain("binaire");
  });
});
