import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ForgeAccount } from "../types/forge";
import type { SshKeyInfo } from "../types/git";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../ipc/commands", () => ({
  sshSetupInfo: vi.fn(),
  sshCreateKey: vi.fn(),
  sshExistingKey: vi.fn(),
  sshHostStatus: vi.fn(),
  sshTrustHost: vi.fn(),
  sshCheckConnection: vi.fn(),
}));

const { SshSetupDialog } = await import("./SshSetupDialog");
const { useAccountsStore } = await import("../store/useAccountsStore");
const commands = vi.mocked(await import("../ipc/commands"));

const account: ForgeAccount = { id: "a", provider: "github", label: "GitHub", base_url: "https://github.com", username: "camille", auth: "pat" };
const key: SshKeyInfo = { name: "id_ed25519", path: "/h/.ssh/id_ed25519", public_key: "ssh-ed25519 AAAA poste", fingerprint: "SHA256:clé", encrypted: false };
const addSshKey = vi.fn();

const open = () => render(<SshSetupDialog account={account} onClose={vi.fn()} />);
const configure = async () => fireEvent.click(await screen.findByRole("button", { name: "Configurer" }));

beforeEach(() => {
  vi.clearAllMocks();
  addSshKey.mockResolvedValue(undefined);
  useAccountsStore.setState({ client: async () => ({ addSshKey }) as never });
  commands.sshSetupInfo.mockResolvedValue({ keys: [], new_key_path: "/h/.ssh/id_ed25519", machine: "poste" });
  commands.sshCreateKey.mockResolvedValue(key);
  commands.sshExistingKey.mockResolvedValue(key);
  commands.sshHostStatus.mockResolvedValue({ state: "known" });
  commands.sshTrustHost.mockResolvedValue(undefined);
  commands.sshCheckConnection.mockResolvedValue({ authenticated: true, username: "camille", message: "Hi camille!" });
});

describe("SshSetupDialog", () => {
  it("n'écrit rien avant la validation, puis crée, enregistre et teste la clé", async () => {
    open();
    await screen.findByRole("button", { name: "Configurer" });
    expect(commands.sshCreateKey).not.toHaveBeenCalled();
    await configure();
    await screen.findByText(/Les dépôts en SSH/);
    expect(commands.sshCreateKey).toHaveBeenCalledWith("Merathon – poste", null);
    expect(addSshKey).toHaveBeenCalledWith("Merathon – poste", key.public_key);
    expect(commands.sshCheckConnection).toHaveBeenCalledWith("github.com", "id_ed25519");
  });

  it("réutilise une clé existante sans en créer", async () => {
    commands.sshSetupInfo.mockResolvedValue({ keys: [key], new_key_path: null, machine: "poste" });
    open();
    await configure();
    await waitFor(() => expect(commands.sshCheckConnection).toHaveBeenCalled());
    expect(commands.sshExistingKey).toHaveBeenCalledWith("id_ed25519");
    expect(commands.sshCreateKey).not.toHaveBeenCalled();
  });

  it("bloque tant que les passphrases diffèrent, et ne garde pas la passphrase", async () => {
    open();
    const pass = await screen.findByLabelText(/Passphrase/);
    fireEvent.change(pass, { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText(/Confirme/), { target: { value: "autre" } });
    expect(screen.getByRole("button", { name: "Configurer" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Confirme/), { target: { value: "secret" } });
    await configure();
    await screen.findByText(/Les dépôts en SSH/);
    expect(commands.sshCreateKey).toHaveBeenCalledWith("Merathon – poste", "secret");
  });

  it("propose l'ajout à la main si le token n'a pas le droit, sans aller plus loin", async () => {
    addSshKey.mockRejectedValue(new Error("Resource not accessible by personal access token"));
    open();
    await configure();
    await screen.findByText(/Resource not accessible/);
    expect(screen.getByRole("textbox", { name: "Clé publique" })).toHaveProperty("value", key.public_key);
    expect(commands.sshHostStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clé ajoutée, continuer" }));
    await waitFor(() => expect(commands.sshCheckConnection).toHaveBeenCalled());
  });

  it("continue si la forge connaît déjà la clé, et signale un autre compte", async () => {
    addSshKey.mockRejectedValue(new Error("key is already in use"));
    commands.sshCheckConnection.mockResolvedValue({ authenticated: true, username: "autre", message: "Hi autre!" });
    open();
    await configure();
    expect(await screen.findByText(/appartient au compte autre/)).toBeTruthy();
  });

  it("fait valider l'empreinte d'une instance inconnue avant de la mémoriser", async () => {
    commands.sshHostStatus.mockResolvedValue({ state: "unknown", fingerprint: "SHA256:serveur", published: false });
    open();
    await configure();
    await screen.findByText("SHA256:serveur");
    expect(commands.sshTrustHost).not.toHaveBeenCalled();
    expect(commands.sshCheckConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "L'empreinte est correcte" }));
    await waitFor(() => expect(commands.sshCheckConnection).toHaveBeenCalled());
    expect(commands.sshTrustHost).toHaveBeenCalledWith("github.com", "SHA256:serveur");
  });

  it("mémorise sans question une empreinte conforme à celle publiée", async () => {
    commands.sshHostStatus.mockResolvedValue({ state: "unknown", fingerprint: "SHA256:publiée", published: true });
    open();
    await configure();
    await waitFor(() => expect(commands.sshTrustHost).toHaveBeenCalledWith("github.com", "SHA256:publiée"));
    await waitFor(() => expect(commands.sshCheckConnection).toHaveBeenCalled());
  });

  it("s'arrête si le serveur présente une empreinte non conforme", async () => {
    commands.sshHostStatus.mockRejectedValue("connexion peut-être interceptée");
    open();
    await configure();
    await screen.findByText(/interceptée/);
    expect(commands.sshCheckConnection).not.toHaveBeenCalled();
  });

  it("explique un refus et permet de vérifier à nouveau", async () => {
    commands.sshCheckConnection.mockResolvedValueOnce({ authenticated: false, username: null, message: "Permission denied (publickey)." });
    open();
    await configure();
    fireEvent.click(await screen.findByRole("button", { name: "Vérifier à nouveau" }));
    await screen.findByText(/Les dépôts en SSH/);
    expect(commands.sshCheckConnection).toHaveBeenCalledTimes(2);
  });
});
