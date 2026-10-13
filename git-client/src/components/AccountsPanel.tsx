import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAccountsStore, defaultBaseUrl } from "../store/useAccountsStore";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore, confirmAction } from "../store/useUiStore";
import { getIdentity, oauthCancel, oauthComplete, oauthDefaults, oauthStart, setIdentity } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { hostOf, instanceUrl } from "../lib/remoteUrl";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { inputClass } from "./Modal";
import { useLinkedForge } from "./PullRequestList";
import { MyPullRequestsSection } from "./MyPullRequests";
import { PanelSection as Section } from "./PanelSection";
import type { DeviceCode, ForgeAccount, ForgeIssue, Provider } from "../types/forge";

type Kind = "github" | "gitlab" | "gitlab-self";

export function AccountsPanel() {
  const accounts = useAccountsStore((s) => s.accounts);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[var(--color-bg-secondary)]">
      <IdentitySection />

      <Section
        title="Comptes"
        action={!adding && (
          <button className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]" onClick={() => setAdding(true)}>
            + Ajouter
          </button>
        )}
      >
        {adding && <AddAccountForm onDone={() => setAdding(false)} />}
        {accounts.map((a) => <AccountRow key={a.id} account={a} />)}
        {accounts.length === 0 && !adding && (
          <p className="px-3 pb-2 text-[11px] text-[var(--color-muted)]">
            Ajoute un compte pour que fetch, pull, push et clone s'authentifient automatiquement en HTTPS.
          </p>
        )}
      </Section>

      {accounts.map((a) => <MyPullRequestsSection key={a.id} account={a} showAccount={accounts.length > 1} />)}
      <RepoIssuesSection />
    </div>
  );
}

// ---------------------------------------------------------------- Identité

function IdentitySection() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [repoOnly, setRepoOnly] = useState(false);
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState<{ name: string | null; email: string | null } | null>(null);

  useEffect(() => {
    getIdentity(repoPath)
      .then((id) => {
        setCurrent(id);
        setName(id.name ?? "");
        setEmail(id.email ?? "");
        if (!id.name || !id.email) setEditing(true);
      })
      .catch(() => setCurrent({ name: null, email: null }));
  }, [repoPath]);

  async function save() {
    try {
      await setIdentity(repoOnly && repoPath ? repoPath : null, name.trim(), email.trim());
      setCurrent({ name: name.trim(), email: email.trim() });
      setEditing(false);
      notify("success", repoOnly ? "Identité enregistrée pour ce dépôt" : "Identité Git globale enregistrée");
    } catch (e) {
      notify("error", errorMessage(e));
    }
  }

  return (
    <Section
      title="Identité Git"
      action={!editing && (
        <button className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]" onClick={() => setEditing(true)}>
          Modifier
        </button>
      )}
    >
      {!editing && current && (
        <p className="px-3 pb-2 text-xs text-[var(--color-text)] truncate" title={`${current.name} <${current.email}>`}>
          {current.name} <span className="text-[var(--color-muted)]">&lt;{current.email}&gt;</span>
        </p>
      )}
      {editing && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          {!current?.name && <p className="text-[11px] text-amber-300">Requis pour commiter.</p>}
          <input className={inputClass} placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputClass} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {repoPath && (
            <label className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <input type="checkbox" checked={repoOnly} onChange={(e) => setRepoOnly(e.target.checked)} />
              Uniquement pour ce dépôt
            </label>
          )}
          <div className="flex gap-2">
            <SmallButton primary disabled={!name.trim() || !email.trim()} onClick={save}>Enregistrer</SmallButton>
            {current?.name && <SmallButton onClick={() => setEditing(false)}>Annuler</SmallButton>}
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- Comptes

function tokenHelpUrl(kind: Kind, url: string): string {
  if (kind === "github") {
    return "https://github.com/settings/tokens/new?scopes=repo,read:user,workflow&description=Merathon";
  }
  return `${url}/-/user_settings/personal_access_tokens?name=Merathon&scopes=api,read_user,write_repository`;
}

const CLIENT_ID_KEY = "git-client.oauth-client-ids";

function savedClientIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CLIENT_ID_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function rememberClientId(host: string, clientId: string) {
  try {
    localStorage.setItem(CLIENT_ID_KEY, JSON.stringify({ ...savedClientIds(), [host]: clientId }));
  } catch {
    // stockage indisponible : il faudra ressaisir l'identifiant
  }
}

/** Page d'enregistrement d'une application OAuth sur la forge. */
function oauthAppHelpUrl(kind: Kind, url: string): string {
  if (kind === "github") return "https://github.com/settings/applications/new";
  return `${url}/-/user_settings/applications`;
}

const KINDS = [
  ["github", "GitHub"],
  ["gitlab", "GitLab.com"],
  ["gitlab-self", "GitLab privé"],
] as const;

const MODES = [
  ["oauth", "Navigateur (OAuth)"],
  ["pat", "Token personnel"],
] as const;

type OAuthDefaults = { github: string | null; gitlab: string | null };

/** Identifiant OAuth intégré à l'application pour cet hôte (GitHub, GitLab.com), sinon null. */
function builtInClientId(host: string | null, defaults: OAuthDefaults | null): string | null {
  if (host === "github.com") return defaults?.github ?? null;
  if (host === "gitlab.com") return defaults?.gitlab ?? null;
  return null;
}

function submitLabel(saving: boolean, mode: "oauth" | "pat"): string {
  if (saving) return "Connexion…";
  return mode === "oauth" ? "Se connecter" : "Connecter";
}

const MISSING_URL = "Renseigne d'abord l'URL de l'instance";

function AddAccountForm({ onDone }: { onDone: () => void }) {
  const add = useAccountsStore((s) => s.add);
  const addConnected = useAccountsStore((s) => s.addConnected);
  const notify = useUiStore((s) => s.notify);
  const [kind, setKind] = useState<Kind>("github");
  const [mode, setMode] = useState<"oauth" | "pat">("oauth");
  const [baseUrl, setBaseUrl] = useState("https://");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [defaults, setDefaults] = useState<OAuthDefaults | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceCode | null>(null);

  const provider: Provider = kind === "github" ? "github" : "gitlab";
  // Instance normalisée (null tant que la saisie est incomplète) : sert aux liens d'aide et à la connexion.
  const url = kind === "gitlab-self" ? instanceUrl(baseUrl) : defaultBaseUrl(provider);
  const host = url ? hostOf(url) : null;

  useEffect(() => {
    oauthDefaults().then(setDefaults).catch(() => {});
  }, []);

  // Identifiant intégré à l'application (GitHub, GitLab.com) : l'utilisateur n'a rien à saisir.
  const builtIn = builtInClientId(host, defaults);
  const showClientId = !builtIn || advanced;
  const effectiveClientId = showClientId ? clientId : builtIn;

  // Champ visible : dernier identifiant saisi pour cet hôte, sinon celui intégré.
  useEffect(() => {
    if (!host) return;
    setClientId(savedClientIds()[host] ?? builtIn ?? "");
  }, [host, builtIn]);

  // Mode par défaut : navigateur si un identifiant est intégré, sinon token personnel.
  useEffect(() => {
    if (!defaults) return;
    setMode(builtIn ? "oauth" : "pat");
    setAdvanced(false);
  }, [kind, builtIn, defaults]);

  const credentialsFilled = mode === "pat" ? !!token.trim() : !!effectiveClientId?.trim();
  const valid = (kind !== "gitlab-self" || !!host) && credentialsFilled;

  async function submitToken() {
    const account = await add({ provider, baseUrl: url!, token: token.trim(), label });
    notify("success", `Compte ${account.username} connecté`);
    onDone();
  }

  async function submitOAuth() {
    const id = effectiveClientId!.trim();
    const code = await oauthStart(provider, url!, id);
    // On ne mémorise que ce que l'utilisateur a saisi lui-même.
    if (showClientId) rememberClientId(host!, id);
    setDevice(code);
    openUrl(code.verification_uri_complete ?? code.verification_uri).catch(() => {});
    try {
      const saved = await oauthComplete(provider, url!, id, code, label || null);
      addConnected(saved);
      notify("success", `Compte ${saved.account.username} connecté`);
      onDone();
    } finally {
      setDevice(null);
    }
  }

  async function submit() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await (mode === "pat" ? submitToken() : submitOAuth());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (device) oauthCancel(device.device_code);
    onDone();
  }

  if (device) return <DeviceCodePanel device={device} onCancel={cancel} />;

  return (
    <form
      className="mx-2 mb-2 p-2 flex flex-col gap-1.5 rounded border border-overlay/10 bg-shade/20"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-3 gap-1">
        {KINDS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`text-[10px] py-1 rounded ${kind === k ? "bg-overlay/15 text-[var(--color-text)]" : "text-[var(--color-muted)] hover:bg-overlay/10"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {kind === "gitlab-self" && (
        <input className={inputClass} placeholder="https://gitlab.mon-entreprise.fr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      )}

      <div className="grid grid-cols-2 gap-1">
        {MODES.map(([m, l]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`text-[10px] py-1 rounded border ${mode === m ? "border-[var(--color-accent)]/60 text-[var(--color-text)]" : "border-overlay/10 text-[var(--color-muted)] hover:bg-overlay/10"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {mode === "pat" && <TokenFields kind={kind} url={url} token={token} onToken={setToken} />}
      {mode === "oauth" && showClientId && (
        <ClientIdFields
          kind={kind}
          url={url}
          clientId={clientId}
          onClientId={setClientId}
          onUseDefault={builtIn ? () => setAdvanced(false) : null}
        />
      )}
      {mode === "oauth" && !showClientId && (
        <p className="text-[10px] text-[var(--color-muted)]">
          Un code s'affichera : saisis-le sur la page {kind === "github" ? "GitHub" : "GitLab"} qui s'ouvrira dans ton navigateur.{" "}
          <button type="button" className="text-sky-400 hover:underline" onClick={() => setAdvanced(true)}>
            Paramètres avancés
          </button>
        </p>
      )}

      <input className={inputClass} placeholder="Nom affiché (optionnel)" value={label} onChange={(e) => setLabel(e.target.value)} />
      {error && <p className="text-[11px] text-red-400 break-words">{error}</p>}
      <div className="flex gap-2">
        <SmallButton primary type="submit" disabled={!valid || saving}>
          {submitLabel(saving, mode)}
        </SmallButton>
        <SmallButton onClick={onDone}>Annuler</SmallButton>
      </div>
      <p className="text-[10px] text-[var(--color-muted)]">Les identifiants sont stockés dans le trousseau du système.</p>
    </form>
  );
}

/** Code à saisir sur la page de la forge pendant la connexion OAuth (device flow). */
function DeviceCodePanel({ device, onCancel }: { device: DeviceCode; onCancel: () => void }) {
  return (
    <div className="mx-2 mb-2 p-3 flex flex-col gap-2 rounded border border-overlay/10 bg-shade/20 text-center">
      <p className="text-[11px] text-[var(--color-muted)]">Saisis ce code sur la page qui vient de s'ouvrir :</p>
      <button
        className="font-mono text-lg tracking-widest text-[var(--color-text)] bg-overlay/10 rounded py-1 hover:bg-overlay/15"
        title="Copier le code"
        onClick={() => navigator.clipboard.writeText(device.user_code)}
      >
        {device.user_code}
      </button>
      <button
        className="text-[10px] text-sky-400 hover:underline"
        onClick={() => openUrl(device.verification_uri_complete ?? device.verification_uri)}
      >
        {device.verification_uri} ↗
      </button>
      <p className="text-[11px] text-[var(--color-muted)] animate-pulse">En attente de la validation…</p>
      <SmallButton onClick={onCancel}>Annuler</SmallButton>
    </div>
  );
}

function TokenFields({ kind, url, token, onToken }: {
  kind: Kind;
  url: string | null;
  token: string;
  onToken: (token: string) => void;
}) {
  return (
    <>
      <input
        className={inputClass}
        type="password"
        autoComplete="off"
        placeholder="Token d'accès personnel"
        value={token}
        onChange={(e) => onToken(e.target.value)}
      />
      <button
        type="button"
        className="text-left text-[10px] text-sky-400 hover:underline disabled:opacity-40"
        disabled={!url}
        title={url ? tokenHelpUrl(kind, url) : MISSING_URL}
        onClick={() => url && openUrl(tokenHelpUrl(kind, url))}
      >
        Créer un token ({kind === "github" ? "scopes repo, read:user, workflow" : "scopes api, read_user, write_repository"}) ↗
      </button>
    </>
  );
}

function ClientIdFields({ kind, url, clientId, onClientId, onUseDefault }: {
  kind: Kind;
  url: string | null;
  clientId: string;
  onClientId: (clientId: string) => void;
  /** Revenir à l'application intégrée, si elle existe pour cet hôte. */
  onUseDefault: (() => void) | null;
}) {
  return (
    <>
      <input
        className={inputClass}
        placeholder="Identifiant client de l'application OAuth"
        value={clientId}
        onChange={(e) => onClientId(e.target.value)}
      />
      <p className="text-[10px] text-[var(--color-muted)]">
        {kind === "github"
          ? "Application OAuth GitHub avec « Enable Device Flow » coché."
          : "Application GitLab non confidentielle, scopes api, read_user, write_repository (GitLab 17.2+)."}{" "}
        <button
          type="button"
          className="text-sky-400 hover:underline disabled:opacity-40"
          disabled={!url}
          title={url ? oauthAppHelpUrl(kind, url) : MISSING_URL}
          onClick={() => url && openUrl(oauthAppHelpUrl(kind, url))}
        >
          Enregistrer une application ↗
        </button>
        {onUseDefault && (
          <>
            {" · "}
            <button type="button" className="text-sky-400 hover:underline" onClick={onUseDefault}>
              Utiliser l'application par défaut
            </button>
          </>
        )}
      </p>
    </>
  );
}

function AccountRow({ account }: { account: ForgeAccount }) {
  const updateToken = useAccountsStore((s) => s.updateToken);
  const renameAccount = useAccountsStore((s) => s.rename);
  const remove = useAccountsStore((s) => s.remove);
  const ask = useUiStore((s) => s.ask);
  const notify = useUiStore((s) => s.notify);
  const { menu, open, close } = useContextMenu();
  const host = hostOf(account.base_url);

  async function changeToken() {
    const result = await ask({
      title: `Nouveau token pour ${account.label}`,
      input: { placeholder: "Token d'accès personnel", secret: true },
      confirmLabel: "Enregistrer",
    });
    const token = result?.value.trim();
    if (!token) return;
    try {
      await updateToken(account, token);
      notify("success", "Token mis à jour");
    } catch (e) {
      notify("error", errorMessage(e));
    }
  }

  async function rename() {
    const result = await ask({ title: "Renommer le compte", input: { initial: account.label }, confirmLabel: "Renommer" });
    const label = result?.value.trim();
    if (label) await renameAccount(account, label).catch((e) => notify("error", errorMessage(e)));
  }

  async function handleRemove() {
    if (!(await confirmAction(`Supprimer le compte ${account.label} ?`, "Le token sera retiré du trousseau.", true))) return;
    await remove(account.id).catch((e) => notify("error", errorMessage(e)));
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 hover:bg-overlay/5 group"
      onContextMenu={(e) => open(e, [
        ...(account.auth === "pat" ? [{ label: "Changer le token…", action: changeToken }] : []),
        { label: "Renommer…", action: rename },
        { label: "Ouvrir le profil", action: () => openUrl(`${account.base_url}/${account.username}`) },
        "separator",
        { label: "Supprimer", danger: true, action: handleRemove },
      ])}
    >
      <ProviderIcon provider={account.provider} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-text)] truncate">{account.label}</p>
        <p className="text-[10px] text-[var(--color-muted)] truncate">
          {account.username} · {host}
          {account.auth === "oauth" && <span className="ml-1 px-1 rounded bg-sky-500/20 text-sky-300">OAuth</span>}
        </p>
      </div>
      <button
        className="text-[var(--color-muted)] hover:text-[var(--color-text)] opacity-0 group-hover:opacity-100 text-xs px-1"
        title="Options"
        onClick={(e) => open(e, [
          ...(account.auth === "pat" ? [{ label: "Changer le token…", action: changeToken }] : []),
          { label: "Renommer…", action: rename },
          "separator",
          { label: "Supprimer", danger: true, action: handleRemove },
        ])}
      >
        ⋯
      </button>
      {menu && <ContextMenu menu={menu} onClose={close} />}
    </div>
  );
}

// ---------------------------------------------------------------- Issues du dépôt courant
// (ses PR / MR sont dans l'onglet Dépôt ; ici, celles de tous les projets : voir MyPullRequestsSection)

function RepoIssuesSection() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const remotes = useRepoStore((s) => s.remotes);
  const data = useAccountsStore((s) => s.data);
  const setData = useAccountsStore((s) => s.setData);
  const client = useAccountsStore((s) => s.client);
  const forge = useLinkedForge();

  const account = forge?.account;
  const projectPath = forge?.projectPath;
  const accountData = account ? data[account.id] : undefined;

  const loadIssues = useCallback(async () => {
    if (!account || !projectPath) return;
    setData(account.id, { loading: true, error: null });
    try {
      const issues = await (await client(account)).getIssues(projectPath);
      setData(account.id, { issues, loading: false });
    } catch (e) {
      setData(account.id, { loading: false, error: errorMessage(e) });
    }
  }, [account, projectPath, client, setData]);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  if (!repoPath) return null;

  if (!forge) {
    return (
      <Section title="Issues du dépôt">
        <p className="px-3 pb-2 text-[11px] text-[var(--color-muted)]">
          {remotes.length === 0
            ? "Ce dépôt n'a aucun remote."
            : "Aucun compte ne correspond aux remotes de ce dépôt (l'hôte du remote doit être celui du compte)."}
        </p>
      </Section>
    );
  }

  return (
    <Section
      title={`Issues · ${forge.projectPath} (${accountData?.issues.length ?? 0})`}
      action={
        <button className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]" title="Rafraîchir" onClick={loadIssues}>
          ↻
        </button>
      }
    >
      {accountData?.loading && <p className="px-3 py-1 text-xs text-[var(--color-muted)] animate-pulse">Chargement…</p>}
      {accountData?.error && <p className="px-3 py-1 text-xs text-red-400 break-words">{accountData.error}</p>}
      {!accountData?.loading && !accountData?.error && (
        <>
          {accountData?.issues.map((issue) => <IssueRow key={issue.number} issue={issue} />)}
          {accountData?.issues.length === 0 && <Empty text="Aucune issue ouverte" />}
        </>
      )}
    </Section>
  );
}

function IssueRow({ issue }: { issue: ForgeIssue }) {
  return (
    <div className="px-3 py-1.5 hover:bg-overlay/5 cursor-pointer" onClick={() => openUrl(issue.url)}>
      <div className="flex items-start gap-2">
        <span className={`shrink-0 text-xs ${issue.state === "open" ? "text-green-400" : "text-red-400"}`}>●</span>
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text)] truncate">{issue.title}</p>
          <p className="text-[10px] text-[var(--color-muted)]">#{issue.number} · {issue.author}</p>
        </div>
      </div>
    </div>
  );
}

function ProviderIcon({ provider }: { provider: Provider }) {
  return (
    <span
      className={`w-5 h-5 shrink-0 rounded flex items-center justify-center text-[10px] font-bold ${
        provider === "github" ? "bg-overlay/15 text-[var(--color-text)]" : "bg-orange-500/30 text-orange-300"
      }`}
    >
      {provider === "github" ? "GH" : "GL"}
    </span>
  );
}

function SmallButton({ onClick, disabled, primary, type = "button", children }: {
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: "button" | "submit";
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2.5 py-1 rounded disabled:opacity-40 ${
        primary ? "bg-[var(--color-accent)] text-white font-semibold hover:opacity-90" : "bg-overlay/10 text-[var(--color-text)] hover:bg-overlay/15"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-1 text-xs text-[var(--color-muted)] italic">{text}</p>;
}
