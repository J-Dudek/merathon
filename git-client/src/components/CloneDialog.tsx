import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAccountsStore } from "../store/useAccountsStore";
import { openRepoAt } from "../lib/repoActions";
import { useUiStore } from "../store/useUiStore";
import { cloneRepository } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import type { ForgeRepo } from "../types/forge";
import { Button, Modal, inputClass } from "./Modal";
import { trimEndChars } from "../lib/strings";

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
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setParentDir(dir);
  }

  async function handleClone() {
    if (!url.trim() || !parentDir || !name.trim()) return;
    const sep = parentDir.includes("\\") && !parentDir.includes("/") ? "\\" : "/";
    const target = `${trimEndChars(parentDir, "\\/")}${sep}${name.trim()}`;
    setCloning(true);
    try {
      const warning = await cloneRepository(url.trim(), target);
      await openRepoAt(target);
      notify(warning ? "info" : "success", warning ?? `Dépôt cloné dans ${target}`);
      onClose();
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setCloning(false);
    }
  }

  return (
    <Modal title="Cloner un dépôt" onClose={() => !cloning && onClose()} width="w-[560px]">
      <div className="p-4 flex flex-col gap-3">
        {accounts.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">Depuis un compte</span>
              <select
                className={`${inputClass} w-auto! shrink-0`}
                value={accountId ?? ""}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
              <input className={inputClass} placeholder="Filtrer…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="h-44 overflow-y-auto border border-overlay/10 rounded">
              {reposLoading && <p className="p-2 text-xs text-[var(--color-muted)] animate-pulse">Chargement…</p>}
              {reposError && <p className="p-2 text-xs text-red-400 break-words">{reposError}</p>}
              {!reposLoading && !reposError && visibleRepos.map((r) => (
                <button
                  key={r.fullName}
                  onClick={() => setUrl(r.cloneUrl)}
                  className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 hover:bg-overlay/5 ${
                    url === r.cloneUrl ? "bg-overlay/10" : ""
                  }`}
                >
                  <span className="font-mono text-[var(--color-text)] truncate">{r.fullName}</span>
                  {r.private && <span className="text-[9px] px-1 rounded border border-overlay/20 text-[var(--color-muted)]">privé</span>}
                  <span className="ml-auto text-[10px] text-[var(--color-muted)] truncate max-w-[45%]">{r.description}</span>
                </button>
              ))}
              {!reposLoading && !reposError && visibleRepos.length === 0 && (
                <p className="p-2 text-xs text-[var(--color-muted)] italic">Aucun dépôt</p>
              )}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">URL</span>
          <input
            autoFocus
            className={inputClass}
            placeholder="https://github.com/owner/repo.git ou git@gitlab.com:group/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>

        <div className="flex gap-2 items-end">
          <label className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">Dossier parent</span>
            <input className={inputClass} readOnly placeholder="Choisir…" value={parentDir} onClick={chooseDir} />
          </label>
          <Button onClick={chooseDir}>Parcourir</Button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">Nom du dossier</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
        </label>

        <p className="text-[10px] text-[var(--color-muted)]">
          Les identifiants du compte correspondant à l'hôte de l'URL sont utilisés automatiquement (HTTPS),
          sinon l'agent SSH ou tes clés ~/.ssh.
        </p>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={cloning}>Annuler</Button>
          <Button variant="primary" onClick={handleClone} disabled={cloning || !url.trim() || !parentDir || !name.trim()}>
            {cloning ? "Clonage…" : "Cloner"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
