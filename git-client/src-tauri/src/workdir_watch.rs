//! Surveillance du dépôt affiché : une modification faite hors de Merathon (éditeur, terminal intégré, `git` en ligne
//! de commande) est signalée au frontend, qui relit le statut et le diff ouvert sans attendre le retour sur la fenêtre.
//!
//! Une surveillance par fenêtre, remplacée quand la fenêtre affiche un autre dépôt et arrêtée à sa fermeture.
//! Les événements sont regroupés ([`DEBOUNCE`]) : une sauvegarde ou un `git commit` en produit plusieurs.
//! Sont ignorés : les fichiers ignorés par Git (`target/`, `node_modules/`…), les lectures (Merathon lit lui-même les
//! fichiers pour afficher un diff) et l'intérieur de `.git`, sauf `HEAD`, l'index et les références.
//!
//! Sous WSL, un dépôt sous `/mnt/c` modifié depuis Windows ne produit pas d'événement : le rafraîchissement au retour
//! sur la fenêtre reste alors le seul signal.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use git2::Repository;
use notify::event::EventKind;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::ipc::Channel;

/// Délai de regroupement des événements.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// Ce qui a changé depuis le dernier signal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct WorkdirChange {
    /// Fichiers de la copie de travail ou index : le statut est à relire.
    pub status: bool,
    /// `HEAD` ou références (commit, checkout, fetch…) : tout le dépôt est à relire.
    pub refs: bool,
}

impl WorkdirChange {
    fn is_empty(&self) -> bool {
        !self.status && !self.refs
    }
}

/// Surveillances en cours, par fenêtre. Supprimer l'entrée arrête la surveillance et son fil.
#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, RecommendedWatcher>>);

impl Watchers {
    /// Arrête la surveillance d'une fenêtre fermée.
    pub fn close_window(&self, window: &str) {
        self.0.lock().unwrap().remove(window);
    }
}

/// Emplacements du dépôt, résolus une fois pour classer les chemins des événements.
struct Layout {
    workdir: PathBuf,
    /// Dossier Git propre à la copie de travail (`.git`, ou `.git/worktrees/<nom>` pour un worktree).
    gitdir: PathBuf,
    /// Dossier Git commun (références partagées entre worktrees).
    commondir: PathBuf,
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

impl Layout {
    fn of(repo: &Repository) -> Option<Self> {
        Some(Self {
            workdir: canonical(repo.workdir()?),
            gitdir: canonical(repo.path()),
            commondir: canonical(repo.commondir()),
        })
    }

    /// Ce que signale une modification de `path`.
    fn classify(&self, repo: &Repository, path: &Path) -> WorkdirChange {
        let none = WorkdirChange::default();
        if let Ok(rel) = path.strip_prefix(&self.gitdir) {
            return match rel.to_str() {
                Some("HEAD") => WorkdirChange { refs: true, ..none },
                Some("index") => WorkdirChange { status: true, ..none },
                _ => self.classify_common(path),
            };
        }
        if path.starts_with(&self.commondir) {
            return self.classify_common(path);
        }
        let Ok(rel) = path.strip_prefix(&self.workdir) else { return none };
        if rel.as_os_str().is_empty() {
            return none;
        }
        // En cas de doute (chemin illisible pour libgit2), on préfère relire le statut pour rien.
        if repo.is_path_ignored(rel).unwrap_or(false) {
            return none;
        }
        WorkdirChange { status: true, ..none }
    }

    /// Chemin dans le dossier Git commun : seules les références comptent (pas les objets, journaux, verrous…).
    fn classify_common(&self, path: &Path) -> WorkdirChange {
        let none = WorkdirChange::default();
        let Ok(rel) = path.strip_prefix(&self.commondir) else { return none };
        if path.extension().is_some_and(|e| e == "lock") {
            return none;
        }
        let refs = rel == Path::new("packed-refs") || rel.starts_with("refs");
        WorkdirChange { refs, ..none }
    }
}

/// Événement qui modifie le contenu ou l'existence d'un fichier ; les lectures et ouvertures sont ignorées.
fn is_change(kind: &EventKind) -> bool {
    match kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any => true,
        EventKind::Access(_) | EventKind::Other => false,
    }
}

fn watch(path: &str, on_change: Channel<WorkdirChange>) -> Result<RecommendedWatcher, String> {
    let repo = Repository::open(path).map_err(|e| e.message().to_string())?;
    let layout = Layout::of(&repo).ok_or_else(|| tr!("Dépôt sans copie de travail", "Repository without a working tree"))?;

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher.watch(&layout.workdir, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    // Worktree ou `GIT_DIR` séparé : le dossier Git n'est pas dans la copie de travail.
    if !layout.gitdir.starts_with(&layout.workdir) {
        let _ = watcher.watch(&layout.gitdir, RecursiveMode::NonRecursive);
    }
    if !layout.commondir.starts_with(&layout.workdir) {
        let _ = watcher.watch(&layout.commondir, RecursiveMode::NonRecursive);
        let _ = watcher.watch(&layout.commondir.join("refs"), RecursiveMode::Recursive);
    }

    // Le fil s'arrête quand la surveillance est supprimée (canal fermé) ou que le frontend ne l'écoute plus.
    std::thread::spawn(move || {
        let absorb = |change: &mut WorkdirChange, event: notify::Result<notify::Event>| {
            let Ok(event) = event else {
                // Événements perdus (file du noyau pleine…) : on relit tout par précaution.
                *change = WorkdirChange { status: true, refs: true };
                return;
            };
            if !is_change(&event.kind) {
                return;
            }
            for p in &event.paths {
                if change.status && change.refs {
                    return;
                }
                let c = layout.classify(&repo, p);
                change.status |= c.status;
                change.refs |= c.refs;
            }
        };
        loop {
            let Ok(first) = rx.recv() else { return };
            let mut change = WorkdirChange::default();
            absorb(&mut change, first);
            let deadline = Instant::now() + DEBOUNCE;
            loop {
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(event) => absorb(&mut change, event),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if !change.is_empty() && on_change.send(change).is_err() {
                return;
            }
        }
    });
    Ok(watcher)
}

/// Surveille le dépôt `path` pour la fenêtre appelante, à la place du dépôt surveillé jusque-là.
#[tauri::command(async)]
pub fn workdir_watch(
    window: tauri::Window,
    watchers: tauri::State<'_, Watchers>,
    path: String,
    on_change: Channel<WorkdirChange>,
) -> Result<(), String> {
    let label = window.label().to_string();
    // L'ancienne surveillance est arrêtée même si la nouvelle échoue.
    watchers.close_window(&label);
    let watcher = watch(&path, on_change)?;
    watchers.0.lock().unwrap().insert(label, watcher);
    Ok(())
}

/// Arrête la surveillance de la fenêtre appelante (plus aucun dépôt affiché).
#[tauri::command]
pub fn workdir_unwatch(window: tauri::Window, watchers: tauri::State<'_, Watchers>) {
    watchers.close_window(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (tempfile::TempDir, Repository, Layout) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        fs::write(dir.path().join(".gitignore"), "target/\n*.log\n").unwrap();
        let layout = Layout::of(&repo).unwrap();
        (dir, repo, layout)
    }

    const STATUS: WorkdirChange = WorkdirChange { status: true, refs: false };
    const REFS: WorkdirChange = WorkdirChange { status: false, refs: true };
    const NONE: WorkdirChange = WorkdirChange { status: false, refs: false };

    #[test]
    fn classify_workdir_files() {
        let (_dir, repo, l) = setup();
        assert_eq!(l.classify(&repo, &l.workdir.join("src/main.rs")), STATUS);
        assert_eq!(l.classify(&repo, &l.workdir.join("target/debug/app")), NONE);
        assert_eq!(l.classify(&repo, &l.workdir.join("build.log")), NONE);
        assert_eq!(l.classify(&repo, &l.workdir), NONE);
        assert_eq!(l.classify(&repo, Path::new("/ailleurs/fichier")), NONE);
    }

    #[test]
    fn classify_git_dir() {
        let (_dir, repo, l) = setup();
        assert_eq!(l.classify(&repo, &l.gitdir.join("HEAD")), REFS);
        assert_eq!(l.classify(&repo, &l.gitdir.join("index")), STATUS);
        assert_eq!(l.classify(&repo, &l.gitdir.join("refs/heads/main")), REFS);
        assert_eq!(l.classify(&repo, &l.gitdir.join("packed-refs")), REFS);
        assert_eq!(l.classify(&repo, &l.gitdir.join("refs/heads/main.lock")), NONE);
        assert_eq!(l.classify(&repo, &l.gitdir.join("index.lock")), NONE);
        assert_eq!(l.classify(&repo, &l.gitdir.join("objects/ab/cdef")), NONE);
        assert_eq!(l.classify(&repo, &l.gitdir.join("FETCH_HEAD")), NONE);
        assert_eq!(l.classify(&repo, &l.gitdir.join("logs/HEAD")), NONE);
    }

    #[test]
    fn reads_are_not_changes() {
        use notify::event::{AccessKind, AccessMode, CreateKind, DataChange, ModifyKind};
        assert!(!is_change(&EventKind::Access(AccessKind::Open(AccessMode::Read))));
        assert!(!is_change(&EventKind::Access(AccessKind::Close(AccessMode::Write))));
        assert!(is_change(&EventKind::Modify(ModifyKind::Data(DataChange::Any))));
        assert!(is_change(&EventKind::Create(CreateKind::File)));
    }

    #[test]
    fn ignored_files_are_silent() {
        let (dir, _repo, _l) = setup();
        fs::create_dir_all(dir.path().join("target")).unwrap();
        let (tx, rx) = mpsc::channel();
        let channel = Channel::new(move |body| {
            let _ = tx.send(body);
            Ok(())
        });
        let _watcher = watch(dir.path().to_str().unwrap(), channel).unwrap();
        fs::write(dir.path().join("target/out"), "ignoré").unwrap();
        fs::write(dir.path().join("build.log"), "ignoré").unwrap();
        assert!(rx.recv_timeout(DEBOUNCE * 3).is_err(), "signal inattendu");
    }

    #[test]
    fn signals_external_edit() {
        let (dir, _repo, _l) = setup();
        let (tx, rx) = mpsc::channel();
        let channel = Channel::new(move |body| {
            let _ = tx.send(body);
            Ok(())
        });
        let _watcher = watch(dir.path().to_str().unwrap(), channel).unwrap();
        fs::create_dir_all(dir.path().join("target")).unwrap();
        fs::write(dir.path().join("target/out"), "ignoré").unwrap();
        fs::write(dir.path().join("a.txt"), "modifié").unwrap();
        let body = rx.recv_timeout(Duration::from_secs(5)).expect("aucun signal");
        let json = match body {
            tauri::ipc::InvokeResponseBody::Json(s) => s,
            other => panic!("réponse inattendue : {other:?}"),
        };
        assert!(json.contains("\"status\":true"), "{json}");
    }
}
