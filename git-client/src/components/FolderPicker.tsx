import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ChevronUp, Folder, FolderGit2 } from "lucide-react";
import { createDeviceFolder, deviceReposRoot, listDeviceFolders, type DeviceFolder } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { useUiStore } from "../store/useUiStore";
import { Button, Modal, inputClass } from "./Modal";
import { fieldLabel } from "../lib/fieldLabel";
import { tr } from "../i18n";

/** Sélecteur de dossiers sur mobile, limité au dossier privé de l'application (voir device_storage.rs). */
export function FolderPicker() {
  const close = useUiStore((s) => s.closeFolderPicker);
  const [root, setRoot] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [folders, setFolders] = useState<DeviceFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  useEffect(() => {
    deviceReposRoot()
      .then((path) => {
        setRoot(path);
        setDir(path);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback((path: string) => listDeviceFolders(path).then(setFolders), []);

  useEffect(() => {
    if (!dir) return;
    setError(null);
    load(dir).catch((e) => setError(errorMessage(e)));
  }, [dir, load]);

  async function createFolder() {
    if (!dir || !newName?.trim()) return;
    try {
      setDir(await createDeviceFolder(dir, newName));
      setNewName(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const relative = root && dir ? dir.slice(root.length) : "";
  const atRoot = !relative;

  return (
    <Modal title={tr("Choisir un dossier")} onClose={() => close(null)} width="w-[480px]">
      <div className="flex flex-col">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-overlay/10">
          <button
            aria-label={tr("Remonter d'un dossier")}
            disabled={atRoot}
            onClick={() => dir && setDir(dir.slice(0, dir.lastIndexOf("/")))}
            className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full text-[var(--color-text)] active:bg-overlay/10 disabled:opacity-30"
          >
            <ChevronUp size={20} strokeWidth={1.75} />
          </button>
          <span className="text-sm text-[var(--color-text)] truncate" dir="rtl">
            <bdi>{tr("Dépôts de Merathon")}{relative}</bdi>
          </span>
        </div>

        <ul className="h-64 overflow-y-auto">
          {folders.map((f) => {
            const Icon = f.is_repo ? FolderGit2 : Folder;
            return (
              <li key={f.path}>
                <button onClick={() => setDir(f.path)} className="w-full min-h-12 flex items-center gap-3 px-4 py-2 text-left active:bg-overlay/10">
                  <Icon size={20} strokeWidth={1.75} className={`shrink-0 ${f.is_repo ? "text-[var(--color-accent-text)]" : "opacity-70"}`} aria-hidden />
                  <span className="flex-1 min-w-0 text-sm text-[var(--color-text)] truncate">{f.name}</span>
                  {f.is_repo && <span className="text-[11px] text-[var(--color-muted)] shrink-0">{tr("dépôt Git")}</span>}
                  <ChevronRight size={16} className="shrink-0 opacity-50" aria-hidden />
                </button>
              </li>
            );
          })}
          {folders.length === 0 && !error && <li className="p-4 text-sm text-[var(--color-muted)] italic">{tr("Aucun dossier ici")}</li>}
        </ul>

        {error && <p role="alert" className="px-4 py-2 text-xs text-red-400 break-words">{error}</p>}

        {newName !== null && (
          <div className="flex items-center gap-2 px-4 py-2 border-t border-overlay/10">
            <input
              autoFocus
              className={inputClass}
              {...fieldLabel(tr("Nom du dossier"))}
              placeholder={tr("Nom du dossier")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createFolder();
              }}
            />
            <Button onClick={createFolder} disabled={!newName.trim()}>{tr("Créer")}</Button>
          </div>
        )}

        <p className="px-4 py-2 text-[11px] text-[var(--color-muted)] border-t border-overlay/10">
          {tr("Ces dossiers sont privés à Merathon et supprimés à la désinstallation de l'application.")}
        </p>

        <div className="flex flex-wrap justify-end gap-2 px-4 pb-4">
          {newName === null && <Button onClick={() => setNewName("")}>{tr("Nouveau dossier")}</Button>}
          <Button onClick={() => close(null)}>{tr("Annuler")}</Button>
          <Button variant="primary" disabled={!dir} onClick={() => close(dir)}>{tr("Choisir ce dossier")}</Button>
        </div>
      </div>
    </Modal>
  );
}
