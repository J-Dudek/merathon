// Comptes : GitHub Enterprise (instance auto-hébergée), à côté de GitHub, GitLab.com et GitLab privé.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const openUrl = vi.fn(async () => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../ipc/commands", () => ({
  getIdentity: vi.fn(async () => ({ name: "Camille", email: "camille@example.com" })),
  setIdentity: vi.fn(),
  oauthCancel: vi.fn(),
  oauthComplete: vi.fn(),
  oauthDefaults: vi.fn(async () => ({ github: "Iv1.integre", gitlab: null })),
  oauthStart: vi.fn(),
}));
vi.mock("./MyPullRequests", () => ({ MyPullRequestsSection: () => null }));
vi.mock("./PullRequestList", () => ({ useLinkedForge: () => null }));

const { AccountsPanel } = await import("./AccountsPanel");
const { useAccountsStore } = await import("../store/useAccountsStore");

describe("compte GitHub Enterprise", () => {
  const add = vi.fn(async () => ({ id: "ghe", provider: "github" as const, label: "", base_url: "https://github.corp.example", username: "camille", auth: "pat" as const }));

  beforeEach(() => {
    useAccountsStore.setState({ accounts: [], add } as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("demande l'adresse de l'instance et se connecte avec un token, sur l'API de l'instance", async () => {
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "+ Ajouter" }));
    fireEvent.click(screen.getByRole("button", { name: "GitHub Enterprise" }));

    // Pas d'application OAuth intégrée pour une instance privée : token personnel par défaut.
    const token = await screen.findByLabelText("Token d'accès personnel");
    const connect = screen.getByRole("button", { name: "Connecter" });
    fireEvent.change(token, { target: { value: "ghp_test" } });
    expect(connect).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Adresse de l'instance GitHub Enterprise"), { target: { value: "github.corp.example/" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer un token/ }));
    expect(openUrl).toHaveBeenCalledWith("https://github.corp.example/settings/tokens/new?scopes=repo,read:user,workflow&description=Merathon");

    fireEvent.click(connect);
    await waitFor(() => expect(add).toHaveBeenCalledWith({ provider: "github", baseUrl: "https://github.corp.example", token: "ghp_test", label: "" }));
  });

  it("accepte une instance locale en HTTP (tests)", async () => {
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "+ Ajouter" }));
    fireEvent.click(screen.getByRole("button", { name: "GitHub Enterprise" }));
    fireEvent.change(await screen.findByLabelText("Token d'accès personnel"), { target: { value: "t" } });
    fireEvent.change(screen.getByLabelText("Adresse de l'instance GitHub Enterprise"), { target: { value: "http://localhost:8765" } });
    fireEvent.click(screen.getByRole("button", { name: "Connecter" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ provider: "github", baseUrl: "http://localhost:8765" })));
  });
});
