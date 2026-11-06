import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/commands", () => ({
  addPatAccount: vi.fn(async (provider: string, baseUrl: string) => ({
    account: { id: "a", provider, label: "", base_url: baseUrl, username: "camille", auth: "pat" },
    secure_storage: true,
  })),
}));

const { useAccountsStore } = await import("./useAccountsStore");
const commands = vi.mocked(await import("../ipc/commands"));

describe("useAccountsStore.add", () => {
  afterEach(() => vi.clearAllMocks());

  it("envoie le token à l'instance GitHub Enterprise saisie, pas à github.com", async () => {
    await useAccountsStore.getState().add({ provider: "github", baseUrl: "https://github.corp.example/", token: "t" });
    expect(commands.addPatAccount).toHaveBeenCalledWith("github", "https://github.corp.example", "t", null);
  });

  it("garde github.com pour un compte GitHub", async () => {
    await useAccountsStore.getState().add({ provider: "github", baseUrl: "https://github.com", token: "t", label: " Perso " });
    expect(commands.addPatAccount).toHaveBeenCalledWith("github", "https://github.com", "t", "Perso");
  });
});
