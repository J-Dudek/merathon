// Garde-fous du SSH sur Android (issue #38) : tant que la clé de l'appareil (Android Keystore) n'est pas validée sur un
// téléphone, le SSH reste masqué sur mobile. Le bureau garde tout le parcours SSH.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GitProfile } from "../types/git";
import type { ForgeAccount } from "../types/forge";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../ipc/commands", () => ({
  cloneRepository: vi.fn(),
  deviceReposRoot: vi.fn(),
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
  getIdentity: vi.fn(),
  setIdentity: vi.fn(),
  oauthCancel: vi.fn(),
  oauthComplete: vi.fn(),
  oauthDefaults: vi.fn(),
  oauthStart: vi.fn(),
}));
// Sections réseau du panneau des comptes, sans rapport avec le SSH.
vi.mock("./MyPullRequests", () => ({ MyPullRequestsSection: () => null }));
vi.mock("./PullRequestList", () => ({ useLinkedForge: () => null }));

const { CloneDialog } = await import("./CloneDialog");
const { GitProfilesSection } = await import("./GitProfilesSection");
const { AccountsPanel } = await import("./AccountsPanel");
const { useAccountsStore } = await import("../store/useAccountsStore");
const { useRepoStore } = await import("../store/useRepoStore");
const commands = vi.mocked(await import("../ipc/commands"));

const ANDROID = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const original = navigator.userAgent;
function setUserAgent(value: string) {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}

const account: ForgeAccount = { id: "gh", provider: "github", label: "GitHub perso", base_url: "https://github.com", username: "camille", auth: "pat" };
const profile: GitProfile = { id: "pro", label: "Pro", dir: "/dev/pro", user_name: "Camille", user_email: "c@pro.example", account_id: "gh", ssh_key: "/h/.ssh/id_ed25519_pro", managed: true };

beforeEach(() => {
  vi.clearAllMocks();
  // Pas de compte pour le clone : aucune liste de dépôts à charger.
  useAccountsStore.setState({ accounts: [] });
  useRepoStore.setState({ repoPath: null, identity: null });
  commands.listGitProfiles.mockResolvedValue({ profiles: [profile], other_rules: [] });
  commands.deviceReposRoot.mockResolvedValue("/data/user/0/fr.byj6n.merathon/repos");
  commands.sshAllKeys.mockResolvedValue([]);
  commands.getIdentity.mockResolvedValue({ name: null, email: null, local_name: null, local_email: null } as never);
});
afterEach(() => setUserAgent(original));

describe("CloneDialog", () => {
  const typeUrl = (url: string) => fireEvent.change(screen.getByLabelText("URL"), { target: { value: url } });

  it.each(["git@github.com:camille/projet.git", "ssh://git@gitlab.com/camille/projet.git", "git+ssh://git@gitlab.com/camille/projet.git"])(
    "bloque l'URL SSH %s sur Android et propose le HTTPS",
    async (url) => {
      setUserAgent(ANDROID);
      render(<CloneDialog onClose={() => {}} />);
      typeUrl(url);
      expect((await screen.findByRole("alert")).textContent).toContain("utilise l'URL HTTPS du dépôt");
      expect(screen.getByRole("button", { name: "Cloner" })).toHaveProperty("disabled", true);
      // Ni le texte d'aide ni l'exemple d'URL ne parlent de SSH.
      expect(screen.queryByText(/~\/\.ssh/)).toBeNull();
      expect(screen.getByLabelText("URL").getAttribute("placeholder")).toBe("https://github.com/owner/repo.git");
    },
  );

  it("n'affiche pas la clé SSH du profil du dossier cible sur Android", async () => {
    setUserAgent(ANDROID);
    useAccountsStore.setState({ accounts: [account] });
    render(<CloneDialog onClose={() => {}} />);
    expect(await screen.findByText(/Profil « Pro »/)).toBeTruthy();
    expect(screen.queryByText(/id_ed25519_pro/)).toBeNull();
  });

  it("affiche la clé SSH du profil du dossier cible sur le bureau", async () => {
    setUserAgent(DESKTOP);
    useAccountsStore.setState({ accounts: [account] });
    render(<CloneDialog onClose={() => {}} />);
    expect((await screen.findByText(/Profil « Pro »/)).textContent).toContain("clé /h/.ssh/id_ed25519_pro");
  });

  it("laisse cloner en HTTPS sur Android", async () => {
    setUserAgent(ANDROID);
    render(<CloneDialog onClose={() => {}} />);
    typeUrl("https://github.com/camille/projet.git");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cloner" })).toHaveProperty("disabled", false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ne bloque pas le SSH sur le bureau", async () => {
    setUserAgent(DESKTOP);
    render(<CloneDialog onClose={() => {}} />);
    typeUrl("git@github.com:camille/projet.git");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/l'agent SSH ou tes clés ~\/\.ssh/)).toBeTruthy();
    expect(screen.getByLabelText("URL").getAttribute("placeholder")).toContain("git@gitlab.com:group/repo.git");
  });
});

describe("GitProfilesSection", () => {
  it("n'affiche ni clé SSH ni bouton d'enregistrement de clé sur Android", async () => {
    setUserAgent(ANDROID);
    useAccountsStore.setState({ accounts: [account] });
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    expect(screen.queryByText(/Clé SSH/)).toBeNull();
    expect(screen.queryByText(/clé SSH par dossier/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Enregistrer et tester/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nouveau profil" }));
    expect(screen.queryByText("Clé SSH")).toBeNull();
    expect(screen.queryByText(/Passphrase/)).toBeNull();
  });

  it("garde la clé SSH du profil sur le bureau", async () => {
    setUserAgent(DESKTOP);
    useAccountsStore.setState({ accounts: [account] });
    render(<GitProfilesSection />);
    await screen.findByText("Pro");
    expect(screen.getByText(/Clé SSH :/).textContent).toContain("/h/.ssh/id_ed25519_pro");
    expect(screen.getByRole("button", { name: "Enregistrer et tester sur GitHub perso" })).toBeTruthy();
  });
});

describe("AccountsPanel", () => {
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Options du compte GitHub perso" }));

  it("ne propose pas « Configurer SSH… » sur Android", async () => {
    setUserAgent(ANDROID);
    useAccountsStore.setState({ accounts: [account] });
    render(<AccountsPanel />);
    openMenu();
    expect(await screen.findByText("Renommer…")).toBeTruthy();
    expect(screen.queryByText("Configurer SSH…")).toBeNull();
  });

  it("propose « Configurer SSH… » sur le bureau", async () => {
    setUserAgent(DESKTOP);
    useAccountsStore.setState({ accounts: [account] });
    render(<AccountsPanel />);
    openMenu();
    expect(await screen.findByText("Configurer SSH…")).toBeTruthy();
  });
});
