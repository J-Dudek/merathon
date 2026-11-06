import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FilePlus, Search, Trash2 } from "lucide-react";
import { Button, Modal, inputClass } from "./Modal";
import { deleteFile, listFiles, readFile, writeFile } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { isMobile } from "../lib/platform";
import { confirmAction, promptText, useUiStore } from "../store/useUiStore";
import { useRepoStore } from "../store/useRepoStore";
import { tr, trn } from "../i18n";

/** Au-delà, la liste demande de préciser la recherche : des milliers de lignes rendraient la fenêtre lente. */
const MAX_LISTED = 300;

interface OpenFile {
  path: string;
  /** Contenu enregistré sur le disque, pour savoir s'il reste des modifications. */
  saved: string;
  text: string;
  /** Pas encore sur le disque : l'enregistrement le crée. */
  isNew: boolean;
}

/** Fichiers dont le chemin contient tous les mots de la recherche, sans tenir compte de la casse. */
export function filterFiles(files: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? files.filter((f) => words.every((w) => f.toLowerCase().includes(w))) : files;
}

/**
 * Parcourir et modifier les fichiers du dépôt. Sur Android, les dépôts sont dans le dossier privé de l'application :
 * aucun autre éditeur ne peut les ouvrir.
 */
export function FileEditorDialog({ repoPath, initialFile, onClose }: { repoPath: string; initialFile?: string; onClose: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [files, setFiles] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<OpenFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = !!file && (file.isNew || file.text !== file.saved);

  const loadFiles = useCallback(() => {
    listFiles(repoPath).then(setFiles, (e) => setListError(errorMessage(e)));
  }, [repoPath]);

  const openFile = useCallback(async (path: string) => {
    setFileError(null);
    try {
      const content = await readFile(repoPath, path);
      setFile({ path, saved: content, text: content, isNew: false });
    } catch (e) {
      setFileError(errorMessage(e));
    }
  }, [repoPath]);

  useEffect(() => {
    loadFiles();
    if (initialFile) void openFile(initialFile);
  }, [loadFiles, openFile, initialFile]);

  const shown = useMemo(() => filterFiles(files ?? [], query), [files, query]);

  /** Modifications non enregistrées : confirmer avant de les perdre. */
  async function leaveFile(): Promise<boolean> {
    if (!dirty) return true;
    return confirmAction(tr("Abandonner les modifications ?"), tr("Les modifications de {path} ne sont pas enregistrées.", { path: file!.path }), true);
  }

  async function requestClose() {
    if (await leaveFile()) onClose();
  }

  /** Retour à la liste des fichiers (bouton « Fichiers », ou Retour d'Android sur un fichier ouvert). */
  async function back() {
    if (!(await leaveFile())) return;
    setFile(null);
    setFileError(null);
  }

  // Retour d'Android (envoyé comme Échap) sur un fichier ouvert : revient à la liste, comme le diff plein écran d'une
  // PR, au lieu de fermer l'éditeur ; × ferme tout. Intercepté avant la fenêtre, sauf si une confirmation est au-dessus.
  const backRef = useRef(back);
  backRef.current = back;
  const fileOpen = file !== null;
  useEffect(() => {
    if (!fileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || useUiStore.getState().dialog) return;
      e.stopImmediatePropagation();
      void backRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fileOpen]);

  async function newFile() {
    const path = await promptText(tr("Nouveau fichier"), {
      message: tr("Chemin depuis la racine du dépôt ; les dossiers manquants sont créés."),
      placeholder: "docs/notes.md",
    });
    if (!path) return;
    const clean = path.replace(/^\.?\/+/, "");
    if (files?.includes(clean)) {
      await openFile(clean);
      return;
    }
    setFileError(null);
    setFile({ path: clean, saved: "", text: "", isNew: true });
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      await writeFile(repoPath, file.path, file.text, file.isNew);
      notify("success", file.isNew ? tr("{path} créé", { path: file.path }) : tr("{path} enregistré", { path: file.path }));
      if (file.isNew) loadFiles();
      setFile({ ...file, saved: file.text, isNew: false });
      void useRepoStore.getState().refreshStatus();
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!file || file.isNew) return;
    if (!(await confirmAction(tr("Supprimer {path} ?", { path: file.path }), tr("La suppression apparaîtra dans les modifications à commiter."), true))) return;
    try {
      await deleteFile(repoPath, file.path);
      notify("success", tr("{path} supprimé", { path: file.path }));
      setFile(null);
      loadFiles();
      void useRepoStore.getState().refreshStatus();
    } catch (e) {
      notify("error", errorMessage(e));
    }
  }

  const height = isMobile() ? "h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-16px)]" : "h-[80vh]";

  return (
    <Modal title={file ? file.path : tr("Fichiers du dépôt")} onClose={() => void requestClose()} width="w-[900px]" height={height} resizeKey="file-editor">
      {file ? (
        <EditorPane
          file={file}
          dirty={dirty}
          saving={saving}
          onChange={(text) => setFile({ ...file, text })}
          onBack={() => void back()}
          onSave={() => void save()}
          onDelete={() => void remove()}
        />
      ) : (
        <FileList
          files={files}
          shown={shown}
          query={query}
          onQuery={setQuery}
          error={listError ?? fileError}
          onOpen={(path) => void openFile(path)}
          onNew={() => void newFile()}
        />
      )}
    </Modal>
  );
}

function stateLabel(file: OpenFile, dirty: boolean): string {
  if (file.isNew) return tr("Nouveau fichier");
  return dirty ? tr("Modifié, non enregistré") : tr("Enregistré");
}

function EditorPane({ file, dirty, saving, onChange, onBack, onSave, onDelete }: {
  file: OpenFile;
  dirty: boolean;
  saving: boolean;
  onChange: (text: string) => void;
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-2 p-3">
      <div className="flex items-center gap-2">
        <Button onClick={onBack}>
          <ArrowLeft size={13} className="inline -mt-0.5" />{" "}{tr("Fichiers")}
        </Button>
        <span className="text-[11px] text-[var(--color-muted)] truncate">{stateLabel(file, dirty)}</span>
      </div>
      <textarea
        className={`${inputClass} flex-1 min-h-0 resize-none font-mono text-xs leading-relaxed`}
        aria-label={tr("Contenu de {path}", { path: file.path })}
        value={file.text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (dirty && !saving) onSave();
          }
        }}
        // Du code, pas de la prose : ni correction ni majuscule automatiques du clavier.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
      />
      <div className="flex items-center justify-between gap-2">
        {file.isNew ? <span /> : (
          <Button variant="danger" onClick={onDelete} disabled={saving}>
            <Trash2 size={13} className="inline -mt-0.5" />{" "}{tr("Supprimer")}
          </Button>
        )}
        <Button variant="primary" onClick={onSave} disabled={!dirty || saving}>
          {saving ? tr("Enregistrement…") : tr("Enregistrer")}
        </Button>
      </div>
    </div>
  );
}

function FileList({ files, shown, query, onQuery, error, onOpen, onNew }: {
  /** null : liste en cours de chargement. */
  files: string[] | null;
  shown: string[];
  query: string;
  onQuery: (query: string) => void;
  error: string | null;
  onOpen: (path: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-2 p-3">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
          <input
            className={`${inputClass} pl-7`}
            placeholder={tr("Rechercher un fichier…")}
            aria-label={tr("Rechercher un fichier")}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <Button onClick={onNew}>
          <FilePlus size={13} className="inline -mt-0.5" />{" "}{tr("Nouveau fichier")}
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-red-400 break-words">{error}</p>}
      {!files && !error && <p className="text-xs text-[var(--color-muted)]">{tr("Chargement…")}</p>}
      {files && (
        <p className="text-[11px] text-[var(--color-muted)]">
          {trn(shown.length, "{n} fichier", "{n} fichiers")}
          {shown.length > MAX_LISTED ? ` · ${tr("précise la recherche pour voir les autres")}` : ""}
        </p>
      )}
      <ul className="flex-1 min-h-0 overflow-y-auto -mx-1" aria-label={tr("Fichiers du dépôt")}>
        {shown.slice(0, MAX_LISTED).map((path) => {
          const slash = path.lastIndexOf("/");
          return (
            <li key={path}>
              <button
                className="w-full text-left px-2 py-1.5 rounded hover:bg-overlay/10 font-mono text-xs flex items-baseline gap-1 min-w-0"
                onClick={() => onOpen(path)}
                title={path}
              >
                {slash >= 0 && <span className="text-[var(--color-muted)] truncate shrink">{path.slice(0, slash + 1)}</span>}
                <span className="text-[var(--color-text)] shrink-0">{path.slice(slash + 1)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
