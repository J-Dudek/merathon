import { useEffect, useMemo, useState } from "react";
import { useAccountsStore } from "../store/useAccountsStore";
import { openRepoAt } from "../lib/repoActions";
import { useUiStore } from "../store/useUiStore";
import { cloneRepository, deviceReposRoot, listGitProfiles } from "../ipc/commands";
import { pickFolder } from "../lib/folderPicker";
import { isMobile } from "../lib/platform";
import { isSshUrl } from "../lib/remoteUrl";
import { useSshAvailable } from "../lib/sshAvailability";
import { errorMessage } from "../lib/actions";
import { profileForAccount, profileForDir } from "../lib/gitProfiles";
import type { ForgeRepo } from "../types/forge";
import type { GitProfile } from "../types/git";
import { Button, Modal, inputClass } from "./Modal";
import { trimEndChars } from "../lib/strings";
import { fieldLabel } from "../lib/fieldLabel";
import { tr } from "../i18n";

function repoNameFromUrl(url: string): string {
  return trimEndChars(url.trim()).split(/[/:]/).pop()?.replace(/\.git$/, "") || "repo";
}

export function CloneDialog({ onClose }: { onClose: () => void }) {
  const accounts = useAccountsStore((s) => s.accounts);
  const client = useAccountsStore((s) => s.client);
  const notify = useUiStore((s) => s.notify);

  const [url, setUrl] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [repos, setRepos] = useState<ForgeRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [cloning, setCloning] = useState(false);
  const [profiles, setProfiles] = useState<GitProfile[]>([]);
  const [dirChosen, setDirChosen] = useState(false);
  const targetProfile = profileForDir(profiles, parentDir);
  const ssh = useSshAvailable();
  const sshUnavailable = !ssh && isSshUrl(url);
  let credentialsHint = tr("Les identifiants du compte correspondant à l'hôte de l'URL sont utilisés automatiquement.");
  if (!isMobile()) credentialsHint = tr("Les identifiants du compte correspondant à l'hôte de l'URL sont utilisés automatiquement (HTTPS), sinon l'agent SSH ou tes clés ~/.ssh.");
  else if (ssh) credentialsHint = tr("Les identifiants du compte correspondant à l'hôte de l'URL sont utilisés automatiquement (HTTPS), sinon la clé SSH de l'appareil.");

  useEffect(() => {
    listGitProfiles().then((info) => setProfiles(info.profiles)).catch(() => {});
  }, []);

  // Mobile : un seul espace pour les dépôts, proposé d'office.
  useEffect(() => {
    if (isMobile()) deviceReposRoot().then((root) => setParentDir((dir) => dir || root)).catch(() => {});
  }, []);

  // Dossier du profil lié au compte, tant que l'utilisateur n'en a pas choisi un autre.
  useEffect(() => {
    const dir = accountId ? profileForAccount(profiles, accountId)?.dir : undefined;
    if (dir && !dirChosen) setParentDir(dir);
  }, [accountId, profiles, dirChosen]);

  useEffect(() => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    let cancelled = false;
    setReposLoading(true);
    setReposError(null);
    client(account)
      .then((c) => c.listRepos())
      .then((list) => !cancelled && setRepos(list))
      .catch((e) => !cancelled && setReposError(errorMessage(e)))
      .finally(() => !cancelled && setReposLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accountId, accounts, client]);

  useEffect(() => {
    if (!nameTouched) setName(url.trim() ? repoNameFromUrl(url) : "");
  }, [url, nameTouched]);

  const visibleRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  async function chooseDir() {
    const dir = await pickFolder();
    if (!dir) return;
    setParentDir(dir);
    setDirChosen(true);
  }

  async function handleClone() {
    if (!url.trim() || !parentDir || !name.trim()) return;
    const sep = parentDir.includes("\\") && !parentDir.includes("/") ? "\\" : "/";
    const target = `${trimEndChars(parentDir, "\\/")}${sep}${name.trim()}`;
    setCloning(true);
    try {
      const warning = await cloneRepository(url.trim(), target);
      await openRepoAt(target);
      notify(warning ? "info" : "success", warning ?? tr("Dépôt cloné dans {target}", { target }));
      onClose();
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setCloning(false);
    }
  }

  return (
    <Modal title={tr("Cloner un dépôt")} onClose={() => !cloning && onClose()} width="w-[560px]">
      <div className="p-4 flex flex-col gap-3">
        {accounts.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">{tr("Depuis un compte")}</span>
              <select
                className={`${inputClass} w-auto! shrink-0`}
                {...fieldLabel(tr("Compte depuis lequel cloner"))}
                value={accountId ?? ""}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
              <input className={inputClass} placeholder={tr("Filtrer…")} {...fieldLabel(tr("Filtrer les dépôts du compte"))} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="h-44 overflow-y-auto border border-overlay/10 rounded">
              {reposLoading && <p className="p-2 text-xs text-[var(--color-muted)]">{tr("Chargement…")}</p>}
              {reposError && <p className="p-2 text-xs text-red-400 break-words">{reposError}</p>}
              {!reposLoading && !reposError && visibleRepos.map((r) => (
                <button
                  key={r.fullName}
                  onClick={() => setUrl(r.cloneUrl)}
                  aria-pressed={url === r.cloneUrl}
                  className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 hover:bg-overlay/5 ${
                    url === r.cloneUrl ? "bg-overlay/10" : ""
                  }`}
                >
                  <span className="font-mono text-[var(--color-text)] truncate">{r.fullName}</span>
                  {r.private && <span className="text-[9px] px-1 rounded border border-overlay/20 text-[var(--color-muted)]">{tr("privé")}</span>}
                  <span className="ml-auto text-[10px] text-[var(--color-muted)] truncate max-w-[45%]">{r.description}</span>
                </button>
              ))}
              {!reposLoading && !reposError && visibleRepos.length === 0 && (
                <p className="p-2 text-xs text-[var(--color-muted)] italic">{tr("Aucun dépôt")}</p>
              )}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">URL</span>
          <input
            autoFocus
            className={inputClass}
            placeholder={ssh ? tr("https://github.com/owner/repo.git ou git@gitlab.com:group/repo.git") : "https://github.com/owner/repo.git"}
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>

        <div className="flex gap-2 items-end">
          <label className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">{tr("Dossier parent")}</span>
            <input className={inputClass} readOnly required placeholder={tr("Choisir…")} value={parentDir} onClick={chooseDir} />
          </label>
          <Button onClick={chooseDir}>{tr("Parcourir")}</Button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">{tr("Nom du dossier")}</span>
          <input
            className={inputClass}
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
        </label>

        {targetProfile && (
          <p className="text-[11px] text-[var(--color-text)]">
            {tr("Profil « {label} » : commits signés", { label: targetProfile.label })}{" "}{targetProfile.user_email ?? tr("selon ce profil")}
            {targetProfile.ssh_key && !isMobile() ? tr(", clé {ssh_key}", { ssh_key: targetProfile.ssh_key }) : ""}.
          </p>
        )}

        {sshUnavailable && (
          <p role="alert" className="text-[11px] text-amber-300">{tr("Le SSH n'est pas encore pris en charge sur Android : utilise l'URL HTTPS du dépôt.")}</p>
        )}

        <p className="text-[10px] text-[var(--color-muted)]">
          {credentialsHint}
        </p>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={cloning}>{tr("Annuler")}</Button>
          <Button variant="primary" onClick={handleClone} disabled={cloning || sshUnavailable || !url.trim() || !parentDir || !name.trim()}>
            {cloning ? tr("Clonage…") : tr("Cloner")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
