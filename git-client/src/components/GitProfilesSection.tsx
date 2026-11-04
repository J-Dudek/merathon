import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderGit2 } from "lucide-react";
import { Button, inputClass } from "./Modal";
import { SshSetupDialog } from "./SshSetupDialog";
import { deleteGitProfile, listGitProfiles, saveGitProfile, sshAllKeys, sshCreateKey, sshExistingKey } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { keyNameFor } from "../lib/gitProfiles";
import { passphraseProblem } from "../lib/sshSetup";
import { useAccountsStore } from "../store/useAccountsStore";
import { useRepoStore } from "../store/useRepoStore";
import { confirmAction, useUiStore } from "../store/useUiStore";
import type { ForgeAccount } from "../types/forge";
import type { GitProfile, GitProfilesInfo, SshKeyInfo } from "../types/git";
import { tr } from "../i18n";

const NEW_KEY = "__new__";

interface Draft {
  id: string | null;
  label: string;
  dir: string;
  userName: string;
  userEmail: string;
  accountId: string;
  /** Chemin d'une clé, `NEW_KEY`, ou vide pour les clés par défaut. */
  key: string;
}

const emptyDraft: Draft = { id: null, label: "", dir: "", userName: "", userEmail: "", accountId: "", key: "" };
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** Sous Windows, le profil garde `C:/…` et la liste des clés `C:\…` : même fichier. */
const samePath = (a: string, b: string) => a.replace(/\\/g, "/") === b.replace(/\\/g, "/");

/** Rubrique des préférences : une configuration Git par dossier, écrite avec les règles `includeIf` de Git. */
export function GitProfilesSection() {
  const accounts = useAccountsStore((s) => s.accounts);
  const notify = useUiStore((s) => s.notify);
  const [info, setInfo] = useState<GitProfilesInfo | null>(null);
  const [keys, setKeys] = useState<SshKeyInfo[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState<{ account: ForgeAccount; key: SshKeyInfo } | null>(null);

  const reload = useCallback(async () => {
    const [profiles, found] = await Promise.all([listGitProfiles(), sshAllKeys().catch(() => [])]);
    setInfo(profiles);
    setKeys(found);
  }, []);

  useEffect(() => {
    reload().catch((e) => notify("error", errorMessage(e)));
  }, [reload, notify]);

  const accountOf = (id: string | null) => accounts.find((a) => a.id === id);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const creating = draft?.key === NEW_KEY;
  const mismatch = creating ? passphraseProblem(passphrase, confirmation) : null;

  async function chooseDir() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") set({ dir });
  }

  function edit(profile: GitProfile) {
    setDraft({
      id: profile.id,
      label: profile.label,
      dir: profile.dir,
      userName: profile.user_name ?? "",
      userEmail: profile.user_email ?? "",
      accountId: profile.account_id ?? "",
      key: keys.find((k) => profile.ssh_key && samePath(k.path, profile.ssh_key))?.path ?? profile.ssh_key ?? "",
    });
  }

  async function registerKey(account: ForgeAccount, path: string) {
    try {
      setRegistering({ account, key: await sshExistingKey(fileName(path)) });
    } catch (e) {
      notify("error", errorMessage(e));
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      let keyPath = draft.key || null;
      if (draft.key === NEW_KEY) {
        const created = await sshCreateKey(`Merathon – ${draft.label.trim()}`, passphrase || null, keyNameFor(draft.label));
        keyPath = created.path;
      }
      const saved = await saveGitProfile({
        id: draft.id,
        label: draft.label,
        dir: draft.dir,
        user_name: draft.userName,
        user_email: draft.userEmail,
        account_id: draft.accountId || null,
        ssh_key: keyPath,
      });
      const account = accountOf(draft.accountId);
      setDraft(null);
      setPassphrase("");
      setConfirmation("");
      await reload();
      await useRepoStore.getState().refresh().catch(() => {});
      notify("success", tr("Profil « {label} » enregistré", { label: saved.label }));
      // Une clé toute neuve n'est connue d'aucune forge : autant l'enregistrer tout de suite.
      if (creating && account && keyPath) await registerKey(account, keyPath);
    } catch (e) {
      notify("error", errorMessage(e));
      await reload().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  async function remove(profile: GitProfile) {
    const ok = await confirmAction(
      tr("Supprimer le profil « {label} » ?", { label: profile.label }),
      tr("Les dépôts de {dir} reprendront l'identité globale. Les dépôts et les clés SSH ne sont pas touchés.", { dir: profile.dir }),
      true,
    );
    if (!ok) return;
    try {
      await deleteGitProfile(profile.id);
      await reload();
      await useRepoStore.getState().refresh().catch(() => {});
    } catch (e) {
      notify("error", errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{tr("Profils Git")}</h3>
        <p className="text-[var(--color-muted)]">
          {tr("Une identité et une clé SSH par dossier de projets. Git applique lui-même ces règles (includeIf), y compris en ligne de commande. En HTTPS, le token reste choisi d'après l'instance du remote.")}
        </p>
      </div>

      {info?.profiles.map((profile) => {
        const account = accountOf(profile.account_id);
        return (
          <div key={`${profile.id}|${profile.dir}`} className="rounded border border-overlay/10 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <FolderGit2 size={14} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
              <p className="font-semibold truncate flex-1">{profile.label}</p>
              {profile.managed ? (
                <>
                  <Button onClick={() => edit(profile)}>{tr("Modifier")}</Button>
                  <Button onClick={() => remove(profile)}>{tr("Supprimer")}</Button>
                </>
              ) : (
                <span className="text-[10px] text-[var(--color-muted)]">{tr("Règle écrite à la main")}</span>
              )}
            </div>
            <p className="font-mono text-[11px] break-all">{profile.dir}</p>
            <p className="text-[var(--color-muted)]">
              {profile.user_name ?? tr("Nom hérité")} &lt;{profile.user_email ?? tr("e-mail hérité")}&gt;
              {account && ` · ${account.label}`}
              {profile.account_id && !account && tr(" · compte supprimé")}
            </p>
            <p className="text-[var(--color-muted)] flex items-center gap-2 flex-wrap">
              <span className="break-all">{tr("Clé SSH :")}{" "}{profile.ssh_key ?? tr("clés par défaut")}</span>
              {profile.managed && account && profile.ssh_key && (
                <button className="underline hover:text-[var(--color-text)]" onClick={() => registerKey(account, profile.ssh_key!)}>
                  {tr("Enregistrer et tester sur {label}", { label: account.label })}
                </button>
              )}
            </p>
          </div>
        );
      })}

      {info && info.profiles.length === 0 && !draft && <p className="text-[var(--color-muted)] italic">{tr("Aucun profil pour l'instant.")}</p>}

      {info && info.other_rules.length > 0 && (
        <div>
          <p className="font-semibold mb-1">{tr("Autres règles de ~/.gitconfig (conservées telles quelles)")}</p>
          <ul className="font-mono text-[11px] text-[var(--color-muted)] space-y-0.5">
            {info.other_rules.map((rule) => <li key={rule} className="break-all">{rule}</li>)}
          </ul>
        </div>
      )}

      {!draft && <Button variant="primary" onClick={() => setDraft(emptyDraft)}>{tr("Nouveau profil")}</Button>}

      {draft && (
        <form
          className="rounded border border-overlay/10 p-3 space-y-2.5"
          aria-label={draft.id ? tr("Modifier le profil") : tr("Nouveau profil")}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="block font-semibold mb-1">{tr("Nom du profil")}</span>
            <input className={inputClass} placeholder={tr("GitLab pro")} value={draft.label} onChange={(e) => set({ label: e.target.value })} />
          </label>
          <div className="flex gap-2 items-end">
            <label className="block flex-1 min-w-0">
              <span className="block font-semibold mb-1">{tr("Dossier des projets")}</span>
              <input className={inputClass} placeholder={tr("/home/moi/dev/pro")} value={draft.dir} onChange={(e) => set({ dir: e.target.value })} />
            </label>
            <Button onClick={chooseDir}>{tr("Parcourir")}</Button>
          </div>
          <div className="flex gap-2">
            <label className="block flex-1 min-w-0">
              <span className="block font-semibold mb-1">{tr("Nom dans les commits")}</span>
              <input className={inputClass} autoComplete="name" value={draft.userName} onChange={(e) => set({ userName: e.target.value })} />
            </label>
            <label className="block flex-1 min-w-0">
              <span className="block font-semibold mb-1">{tr("E-mail dans les commits")}</span>
              <input className={inputClass} autoComplete="email" value={draft.userEmail} onChange={(e) => set({ userEmail: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="block flex-1 min-w-0">
              <span className="block font-semibold mb-1">{tr("Compte associé")}</span>
              <select className={inputClass} value={draft.accountId} onChange={(e) => set({ accountId: e.target.value })}>
                <option value="">{tr("Aucun")}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <label className="block flex-1 min-w-0">
              <span className="block font-semibold mb-1">{tr("Clé SSH")}</span>
              <select className={inputClass} value={draft.key} onChange={(e) => set({ key: e.target.value })}>
                <option value="">{tr("Clés par défaut")}</option>
                {keys.map((k) => <option key={k.path} value={k.path}>{k.name}{k.encrypted ? " (passphrase)" : ""}</option>)}
                {draft.key && draft.key !== NEW_KEY && !keys.some((k) => k.path === draft.key) && <option value={draft.key}>{fileName(draft.key)}</option>}
                <option value={NEW_KEY}>{tr("Créer {keyNameFor}", { keyNameFor: keyNameFor(draft.label) })}</option>
              </select>
            </label>
          </div>
          {creating && (
            <div className="space-y-1.5">
              <label className="block">
                <span className="block mb-1">{tr("Passphrase de la nouvelle clé (facultative)")}</span>
                <input type="password" autoComplete="new-password" className={inputClass} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </label>
              {passphrase && (
                <label className="block">
                  <span className="block mb-1">{tr("Confirme la passphrase")}</span>
                  <input type="password" autoComplete="new-password" className={inputClass} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
                </label>
              )}
              <p className="text-[11px] text-[var(--color-muted)]">
                {tr("Sans passphrase, quiconque copie le fichier accède à tes dépôts. Avec, ajoute la clé à ton agent SSH (ssh-add) : Merathon ne la demande pas lors des fetch et push.")}
              </p>
              {mismatch && <p role="alert" className="text-amber-300">{mismatch}</p>}
            </div>
          )}
          <p className="text-[11px] text-[var(--color-muted)]">
            {tr("~/.gitconfig est copié avant l'écriture. Un dépôt qui a son propre e-mail le garde : une alerte le signalera.")}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDraft(null)} disabled={saving}>{tr("Annuler")}</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={saving || !draft.label.trim() || !draft.dir.trim() || !draft.userName.trim() || !draft.userEmail.trim() || !!mismatch}
            >
              {tr("Enregistrer")}
            </Button>
          </div>
        </form>
      )}

      {registering && <SshSetupDialog account={registering.account} fixedKey={registering.key} onClose={() => setRegistering(null)} />}
    </div>
  );
}
