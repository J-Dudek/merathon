import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GitProfile, SshKeyInfo } from "../types/git";
import type { ForgeAccount } from "../types/forge";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../ipc/commands", () => ({
  listGitProfiles: vi.fn(),
  saveGitProfile: vi.fn(),
  deleteGitProfile: vi.fn(),
  sshAllKeys: vi.fn(),
  sshCreateKey: vi.fn(),
  sshExistingKey: vi.fn(),
  sshSetupInfo: vi.fn(),
  sshHostStatus: vi.fn(),
  sshTrustHost: vi.fn(),
  sshCheckConnection: vi.fn(),
  clearLocalIdentity: vi.fn(),
}));

const { GitProfilesSection } = await import("./GitProfilesSection");
const { IdentityProblem } = await import("./IdentityProblem");
const { useAccountsStore } = await import("../store/useAccountsStore");
const { useRepoStore } = await import("../store/useRepoStore");
const { useUiStore } = await import("../store/useUiStore");
const commands = vi.mocked(await import("../ipc/commands"));

const account: ForgeAccount = { id: "gl", provider: "gitlab", label: "GitLab pro", base_url: "https://gitlab.corp.io", username: "camille", auth: "pat" };
const key: SshKeyInfo = { name: "id_ed25519_pro", path: "/h/.ssh/id_ed25519_pro", public_key: "ssh-ed25519 AAAA", fingerprint: "SHA256:x", encrypted: false };
const profile: GitProfile = { id: "pro", label: "Pro", dir: "/dev/pro", user_name: "Camille", user_email: "c@pro.example", account_id: "gl", ssh_key: key.path, managed: true };
const manual: GitProfile = { ...profile, id: "", label: ".gitconfig-main", dir: "/dev/main", account_id: null, ssh_key: null, managed: false };

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fillForm() {
  fireEvent.click(screen.getByRole("button", { name: "Nouveau profil" }));
  fill(/Nom du profil/, "Client");
  fill(/Dossier des projets/, "/dev/client");
  fill(/Nom dans les commits/, "Camille");
  fill(/E-mail dans les commits/, "c@client.example");
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

beforeEach(() => {
  vi.clearAllMocks();
  useAccountsStore.setState({ accounts: [account] });
  useRepoStore.setState({ repoPath: null, identity: null });
  commands.listGitProfiles.mockResolvedValue({ profiles: [profile, manual], other_rules: ["onbranch:main → ~/x"] });
  commands.sshAllKeys.mockResolvedValue([key]);
  commands.saveGitProfile.mockImplementation(async (p) => ({ ...profile, label: p.label }));
  commands.sshCreateKey.mockResolvedValue(key);
  commands.sshExistingKey.mockResolvedValue(key);
  commands.sshSetupInfo.mockResolvedValue({ keys: [], new_key_path: "/h/.ssh/id_ed25519", machine: "poste" });
});

describe("GitProfilesSection", () => {
  it("liste les profils et ne laisse modifier que les siens", async () => {
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    expect(screen.getByText("Règle écrite à la main")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Modifier" })).toHaveLength(1);
    expect(screen.getByText("onbranch:main → ~/x")).toBeTruthy();
  });

  it("enregistre un profil avec une clé existante, sans créer de clé", async () => {
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    fillForm();
    fill(/Clé SSH/, key.path);
    fill(/Compte associé/, "gl");
    submit();
    await waitFor(() => expect(commands.saveGitProfile).toHaveBeenCalled());
    expect(commands.saveGitProfile.mock.calls[0][0]).toEqual({
      id: null, label: "Client", dir: "/dev/client", user_name: "Camille", user_email: "c@client.example", account_id: "gl", ssh_key: key.path,
    });
    expect(commands.sshCreateKey).not.toHaveBeenCalled();
  });

  it("crée la clé demandée avant le profil, puis propose de l'enregistrer sur le compte", async () => {
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    fillForm();
    fill(/Compte associé/, "gl");
    fill(/Clé SSH/, "__new__");
    submit();
    await waitFor(() => expect(commands.sshCreateKey).toHaveBeenCalledWith("Merathon – Client", null, "id_ed25519_client"));
    await waitFor(() => expect(commands.saveGitProfile.mock.calls[0][0].ssh_key).toBe(key.path));
    expect(await screen.findByText(/Configurer SSH · GitLab pro/)).toBeTruthy();
    expect(await screen.findByText(key.path)).toBeTruthy();
  });

  it("bloque tant que les passphrases diffèrent", async () => {
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    fillForm();
    fill(/Clé SSH/, "__new__");
    fill(/Passphrase de la nouvelle clé/, "secret");
    fill(/Confirme/, "autre");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toHaveProperty("disabled", true);
  });

  it("garde le formulaire si l'enregistrement est refusé", async () => {
    commands.saveGitProfile.mockRejectedValue("Ce dossier chevauche celui du profil « Pro »");
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    fillForm();
    submit();
    await waitFor(() => expect(useUiStore.getState().toasts.some((t) => t.message.includes("chevauche"))).toBe(true));
    expect(screen.getByLabelText(/Nom du profil/)).toHaveProperty("value", "Client");
  });

  it("demande confirmation avant de supprimer", async () => {
    useUiStore.setState({ ask: async () => null });
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(commands.listGitProfiles).toHaveBeenCalled());
    expect(commands.deleteGitProfile).not.toHaveBeenCalled();
  });
});

describe("IdentityProblem", () => {
  const status = { name: "C", email: "c@perso.example", origin: "repo" as const, profile, mismatch: true, outside: false };

  it("ne dit rien si l'identité est cohérente", () => {
    useRepoStore.setState({ repoPath: "/r", identity: { ...status, mismatch: false } });
    const { container } = render(<IdentityProblem />);
    expect(container.firstChild).toBeNull();
  });

  it("ne retire le réglage du dépôt qu'après confirmation", async () => {
    const refresh = vi.fn(async () => {});
    useRepoStore.setState({ repoPath: "/r", identity: status, refresh });
    useUiStore.setState({ ask: async () => null });
    render(<IdentityProblem />);
    fireEvent.click(screen.getByRole("button", { name: "Utiliser le profil" }));
    await Promise.resolve();
    expect(commands.clearLocalIdentity).not.toHaveBeenCalled();

    useUiStore.setState({ ask: async () => ({ value: "", checked: false }) });
    fireEvent.click(screen.getByRole("button", { name: "Utiliser le profil" }));
    await waitFor(() => expect(commands.clearLocalIdentity).toHaveBeenCalledWith("/r"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
