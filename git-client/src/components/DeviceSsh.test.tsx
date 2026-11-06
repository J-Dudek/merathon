// SSH sur Android avec la clé de l'appareil (issue #38) : réglage « SSH (expérimental) », section des préférences et
// parcours « Configurer SSH… » sans fichier ni passphrase.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ForgeAccount } from "../types/forge";
import type { DeviceKeyStatus, SshKeyInfo } from "../types/git";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../ipc/commands", () => ({
  cloneRepository: vi.fn(),
  deviceReposRoot: vi.fn(),
  listGitProfiles: vi.fn(),
  sshSetupInfo: vi.fn(),
  sshCreateKey: vi.fn(),
  sshExistingKey: vi.fn(),
  sshHostStatus: vi.fn(),
  sshTrustHost: vi.fn(),
  sshCheckConnection: vi.fn(),
  sshDeviceKeyStatus: vi.fn(),
  sshDeviceKeyDelete: vi.fn(),
  getIdentity: vi.fn(),
  setIdentity: vi.fn(),
  oauthCancel: vi.fn(),
  oauthComplete: vi.fn(),
  oauthDefaults: vi.fn(),
  oauthStart: vi.fn(),
}));
vi.mock("./MyPullRequests", () => ({ MyPullRequestsSection: () => null }));
vi.mock("./PullRequestList", () => ({ useLinkedForge: () => null }));

const { CloneDialog } = await import("./CloneDialog");
const { AccountsPanel } = await import("./AccountsPanel");
const { DeviceSshSection } = await import("./DeviceSshSection");
const { SshSetupDialog } = await import("./SshSetupDialog");
const { useAccountsStore } = await import("../store/useAccountsStore");
const { useDisplayStore } = await import("../store/useDisplayStore");
const { useRepoStore } = await import("../store/useRepoStore");
const { useUiStore } = await import("../store/useUiStore");
const commands = vi.mocked(await import("../ipc/commands"));

const ANDROID = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36";
const original = navigator.userAgent;
const setUserAgent = (value: string) => Object.defineProperty(navigator, "userAgent", { value, configurable: true });

const account: ForgeAccount = { id: "gh", provider: "github", label: "GitHub perso", base_url: "https://github.com", username: "camille", auth: "pat" };
const deviceKey: SshKeyInfo = { name: "android-keystore", path: "Android Keystore", public_key: "ecdsa-sha2-nistp256 AAAAE2Vj merathon-android", fingerprint: "SHA256:appareil", encrypted: false };
const ready: DeviceKeyStatus = { state: "ready", key: deviceKey, message: null };
const addSshKey = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  setUserAgent(ANDROID);
  useDisplayStore.setState({ experimentalSsh: false });
  useAccountsStore.setState({ accounts: [], client: async () => ({ addSshKey }) as never });
  useRepoStore.setState({ repoPath: null, identity: null });
  addSshKey.mockResolvedValue(undefined);
  commands.listGitProfiles.mockResolvedValue({ profiles: [], other_rules: [] });
  commands.deviceReposRoot.mockResolvedValue("/data/user/0/fr.byj6n.merathon/repos");
  commands.getIdentity.mockResolvedValue({ name: null, email: null } as never);
  commands.sshDeviceKeyStatus.mockResolvedValue({ state: "absent", key: null, message: null });
  commands.sshSetupInfo.mockResolvedValue({ keys: [], new_key_path: "Android Keystore", machine: "ce téléphone" });
  commands.sshCreateKey.mockResolvedValue(deviceKey);
  commands.sshExistingKey.mockResolvedValue(deviceKey);
  commands.sshHostStatus.mockResolvedValue({ state: "unknown", fingerprint: "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM", published: true });
  commands.sshTrustHost.mockResolvedValue(undefined);
  commands.sshCheckConnection.mockResolvedValue({ authenticated: true, username: null, message: "Clé acceptée par github.com" });
});
afterEach(() => setUserAgent(original));

describe("réglage « SSH (expérimental) » sur Android", () => {
  it("laisse cloner en SSH une fois activé", async () => {
    useDisplayStore.setState({ experimentalSsh: true });
    render(<CloneDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "git@github.com:camille/projet.git" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Cloner" })).toHaveProperty("disabled", false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/sinon la clé SSH de l'appareil/)).toBeTruthy();
  });

  it("fait apparaître « Configurer SSH… » dans les comptes une fois activé", async () => {
    useAccountsStore.setState({ accounts: [account] });
    const { unmount } = render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Options du compte GitHub perso" }));
    await screen.findByText("Renommer…");
    expect(screen.queryByText("Configurer SSH…")).toBeNull();
    unmount();

    useDisplayStore.setState({ experimentalSsh: true });
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Options du compte GitHub perso" }));
    expect(await screen.findByText("Configurer SSH…")).toBeTruthy();
  });
});

describe("DeviceSshSection", () => {
  it("active et désactive le SSH, désactivé par défaut", async () => {
    render(<DeviceSshSection />);
    const toggle = screen.getByRole("checkbox", { name: /Activer le SSH sur cet appareil/ });
    expect(toggle).toHaveProperty("checked", false);
    fireEvent.click(toggle);
    expect(useDisplayStore.getState().experimentalSsh).toBe(true);
    fireEvent.click(toggle);
    expect(useDisplayStore.getState().experimentalSsh).toBe(false);
    expect(await screen.findByText(/Aucune clé pour l'instant/)).toBeTruthy();
  });

  it("affiche la clé de l'appareil et la supprime après confirmation", async () => {
    commands.sshDeviceKeyStatus.mockResolvedValueOnce(ready);
    const confirm = vi.spyOn(useUiStore.getState(), "ask").mockResolvedValue({ value: "" } as never);
    render(<DeviceSshSection />);
    expect(await screen.findByText("SHA256:appareil")).toBeTruthy();
    expect((screen.getByLabelText("Clé publique") as HTMLTextAreaElement).value).toBe(deviceKey.public_key);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la clé de l'appareil" }));
    await waitFor(() => expect(commands.sshDeviceKeyDelete).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText(/Aucune clé pour l'instant/)).toBeTruthy();
  });

  it("explique une clé invalidée et propose de la supprimer", async () => {
    commands.sshDeviceKeyStatus.mockResolvedValueOnce({ state: "invalidated", key: null, message: "La clé SSH de l'appareil n'est plus utilisable" });
    render(<DeviceSshSection />);
    expect((await screen.findByRole("alert")).textContent).toContain("n'est plus utilisable");
    expect(screen.getByRole("button", { name: "Supprimer la clé de l'appareil" })).toBeTruthy();
  });
});

describe("SshSetupDialog avec la clé de l'appareil", () => {
  it("crée la clé dans le Keystore sans passphrase, l'enregistre, valide l'hôte et teste la connexion", async () => {
    render(<SshSetupDialog account={account} onClose={vi.fn()} />);
    expect(await screen.findByText(/coffre de l'appareil \(Android Keystore\)/)).toBeTruthy();
    expect(screen.getByText(/ECDSA P-256/)).toBeTruthy();
    expect(screen.queryByText(/Passphrase/)).toBeNull();
    expect(screen.getByText("Création de la clé dans Android Keystore.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configurer" }));
    await screen.findByText(/Les dépôts en SSH/);
    expect(commands.sshCreateKey).toHaveBeenCalledWith("Merathon – ce téléphone", null);
    expect(addSshKey).toHaveBeenCalledWith("Merathon – ce téléphone", deviceKey.public_key);
    expect(commands.sshTrustHost).toHaveBeenCalledWith("github.com", "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM");
    expect(commands.sshCheckConnection).toHaveBeenCalledWith("github.com", "android-keystore");
  });

  it("explique pourquoi aucune clé n'est proposée", async () => {
    commands.sshSetupInfo.mockResolvedValueOnce({ keys: [], new_key_path: null, machine: "ce téléphone", problem: "Configure d'abord un verrouillage d'écran" });
    render(<SshSetupDialog account={account} onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("verrouillage d'écran");
    expect(screen.queryByText(/id_ed25519/)).toBeNull();
    expect(screen.getByRole("button", { name: "Configurer" })).toHaveProperty("disabled", true);
  });

  it("explique une clé refusée par la forge et une confirmation annulée", async () => {
    commands.sshSetupInfo.mockResolvedValue({ keys: [deviceKey], new_key_path: null, machine: "ce téléphone" });
    commands.sshHostStatus.mockResolvedValue({ state: "known" });
    commands.sshCheckConnection.mockResolvedValueOnce({ authenticated: false, username: null, message: "github.com refuse la clé de cet appareil : ajoute sa clé publique sur la forge." });
    render(<SshSetupDialog account={account} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurer" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ne reconnaît pas encore cette clé");

    commands.sshCheckConnection.mockResolvedValueOnce({ authenticated: false, username: null, message: "Confirmation annulée" });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier à nouveau" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("vérifie à nouveau pour la redemander"));
  });
});
