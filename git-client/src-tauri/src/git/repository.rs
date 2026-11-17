use git2::{Config, ErrorCode, Repository, RepositoryState};
use serde::Serialize;
use super::error::GitError;

#[derive(Debug, Serialize, Clone)]
pub struct RepoInfo {
    pub path: String,
    pub head_branch: Option<String>,
    pub head_detached: bool,
    pub head_hash: Option<String>,
    /// clean | merge | rebase | cherrypick | revert | bisect | apply
    pub state: String,
    /// Message préparé par git (MERGE_MSG) lors d'un merge / cherry-pick / revert en cours.
    pub pending_message: Option<String>,
    /// Rebase interactif arrêté (conflit ou commit à modifier).
    pub interactive_rebase: Option<super::interactive::InteractiveStop>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

pub fn open_repo(path: &str) -> Result<Repository, GitError> {
    Repository::open(path).map_err(|e| match e.code() {
        ErrorCode::NotFound => GitError::NotFound(path.to_string()),
        ErrorCode::Owner => GitError::Untrusted(path.to_string()),
        _ => GitError::Git(e),
    })
}

/// Valeur `safe.directory` d'un dépôt, telle que libgit2 et Git for Windows la comparent :
/// séparateurs `/`, sans `/` final, et préfixe `%(prefix)/` pour les chemins commençant par `/`
/// (dont les chemins UNC `//wsl.localhost/…`).
fn safe_directory_entry(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
    if trimmed.starts_with('/') {
        format!("%(prefix)/{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Ajoute le dépôt à `safe.directory` dans la configuration Git globale de l'utilisateur
/// (même effet que `git config --global --add safe.directory …`).
/// Fichiers suivis examinés pour juger si le système de fichiers conserve les droits.
#[cfg(unix)]
const FILEMODE_SAMPLE: usize = 500;
/// En dessous de ce nombre de fichiers examinés, rien ne prouve que les droits sont faussés.
#[cfg(unix)]
const FILEMODE_MIN_FILES: usize = 3;

/// Désactive `core.filemode` quand le système de fichiers ne conserve pas les droits : sur un dossier partagé Synology (ACL), un
/// partage réseau ou un volume FAT, tout fichier créé sort exécutable (`rwxrwxrwx`). Git compare alors les droits (`100644` dans l'index,
/// `100755` sur le disque) et signale **chaque fichier** comme modifié, sans aucune différence de contenu.
///
/// Le critère est volontairement prudent : au moins [`FILEMODE_MIN_FILES`] fichiers suivis sans droit d'exécution dans l'index, **tous**
/// exécutables sur le disque. Un dépôt normal n'en a jamais, et un fichier réellement exécutable (`100755` dans l'index) est ignoré.
/// Renvoie `true` si le réglage vient d'être changé.
pub fn fix_unreliable_filemode(repo: &Repository) -> Result<bool, GitError> {
    #[cfg(not(unix))]
    {
        let _ = repo;
        Ok(false)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut config = repo.config()?;
        if !config.snapshot()?.get_bool("core.filemode").unwrap_or(true) {
            return Ok(false);
        }
        let Some(workdir) = repo.workdir() else { return Ok(false) };
        let index = repo.index()?;
        let (mut seen, mut executable) = (0usize, 0usize);
        for entry in index.iter().take(FILEMODE_SAMPLE) {
            if entry.mode != 0o100_644 {
                continue;
            }
            let Ok(relative) = std::str::from_utf8(&entry.path) else { continue };
            let Ok(meta) = std::fs::symlink_metadata(workdir.join(relative)) else { continue };
            if !meta.is_file() {
                continue;
            }
            seen += 1;
            if meta.permissions().mode() & 0o111 != 0 {
                executable += 1;
            }
        }
        if seen < FILEMODE_MIN_FILES || executable != seen {
            return Ok(false);
        }
        config.set_bool("core.filemode", false)?;
        crate::debug_log::debug(|| format!("core.filemode désactivé : {seen} fichiers suivis sont tous exécutables sur le disque (ACL, partage réseau ?)"));
        Ok(true)
    }
}

pub fn trust_repo(path: &str) -> Result<(), GitError> {
    let file = match Config::find_global() {
        Ok(file) => file,
        // Pas encore de ~/.gitconfig : on le crée.
        Err(_) => std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(|home| std::path::PathBuf::from(home).join(".gitconfig"))
            .ok_or_else(|| GitError::Other(tr!("configuration Git globale introuvable", "global Git configuration not found")))?,
    };
    add_safe_directory(&mut Config::open(&file)?, &safe_directory_entry(path))
}

fn add_safe_directory(config: &mut Config, entry: &str) -> Result<(), GitError> {
    let mut present = false;
    config.multivar("safe.directory", None)?.for_each(|e| present |= e.value().is_ok_and(|v| v == entry))?;
    if !present {
        // Regex qui ne correspond à aucune valeur : ajoute une entrée au lieu d'en remplacer.
        config.set_multivar("safe.directory", "a^", entry)?;
    }
    Ok(())
}

pub fn repo_info(repo: &Repository) -> Result<RepoInfo, GitError> {
    let head = repo.head().ok();
    let head_detached = repo.head_detached().unwrap_or(false);
    let head_branch = if head_detached {
        None
    } else {
        head.as_ref()
            .and_then(|h| h.shorthand().ok().map(str::to_string))
            // Dépôt sans commit : HEAD pointe vers une branche qui n'existe pas encore.
            .or_else(|| unborn_branch_name(repo))
    };

    let state = match repo.state() {
        RepositoryState::Clean => "clean",
        RepositoryState::Merge => "merge",
        RepositoryState::Revert | RepositoryState::RevertSequence => "revert",
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "cherrypick",
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => "rebase",
        RepositoryState::Bisect => "bisect",
        RepositoryState::ApplyMailbox | RepositoryState::ApplyMailboxOrRebase => "apply",
    };

    Ok(RepoInfo {
        path: repo
            .workdir()
            .unwrap_or_else(|| repo.path())
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .to_string(),
        head_branch,
        head_detached,
        head_hash: head.and_then(|h| h.target()).map(|o| o.to_string()),
        state: state.to_string(),
        pending_message: repo.message().ok().map(|m| m.trim_end().to_string()),
        interactive_rebase: super::interactive::interactive_status(repo),
    })
}

fn unborn_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.find_reference("HEAD").ok()?;
    let target = head.symbolic_target().ok().flatten()?;
    target.strip_prefix("refs/heads/").map(str::to_string)
}

pub fn get_identity(repo: &Repository) -> Result<Identity, GitError> {
    let config = repo.config()?.snapshot()?;
    Ok(Identity {
        name: config.get_string("user.name").ok(),
        email: config.get_string("user.email").ok(),
    })
}

/// Enregistre user.name / user.email, dans la config globale ou celle du dépôt.
pub fn set_identity(repo: Option<&Repository>, name: &str, email: &str) -> Result<(), GitError> {
    let mut config = match repo {
        Some(r) => r.config()?.open_level(git2::ConfigLevel::Local)?,
        None => git2::Config::open_default()?.open_global()?,
    };
    config.set_str("user.name", name)?;
    config.set_str("user.email", email)?;
    Ok(())
}

/// Signature de l'utilisateur, avec un message explicite si l'identité n'est pas configurée.
pub fn signature(repo: &Repository) -> Result<git2::Signature<'static>, GitError> {
    repo.signature().map_err(|_| {
        GitError::Other(
            tr!("Identité Git non configurée : renseigne ton nom et ton email dans l'onglet Comptes", "Git identity not configured: enter your name and email in the Accounts tab"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn init_test_repo() -> (TempDir, git2::Repository) {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        (dir, repo)
    }

    #[cfg(unix)]
    mod filemode {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        /// Dépôt avec `n` fichiers commités, dont `executable` en 100755 dans l'index.
        fn committed_repo(n: usize, executable: usize) -> (TempDir, git2::Repository) {
            let (dir, repo) = init_test_repo();
            for i in 0..n {
                let path = dir.path().join(format!("f{i}.txt"));
                std::fs::write(&path, format!("contenu {i}\n")).unwrap();
                let mode = if i < executable { 0o755 } else { 0o644 };
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
            }
            let mut index = repo.index().unwrap();
            index.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
            index.write().unwrap();
            {
                let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
                let sig = git2::Signature::now("T", "t@example.com").unwrap();
                repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
            }
            (dir, repo)
        }

        fn chmod_all(dir: &TempDir, mode: u32) {
            for entry in std::fs::read_dir(dir.path()).unwrap().flatten() {
                if entry.file_type().unwrap().is_file() {
                    std::fs::set_permissions(entry.path(), std::fs::Permissions::from_mode(mode)).unwrap();
                }
            }
        }

        fn dirty_files(dir: &TempDir) -> usize {
            let repo = git2::Repository::open(dir.path()).unwrap();
            crate::git::get_status(&repo).unwrap().len()
        }

        #[test]
        fn all_files_executable_on_disk_is_the_acl_symptom() {
            let (dir, repo) = committed_repo(6, 0);
            chmod_all(&dir, 0o777); // ce que fait un dossier partagé Synology à la création
            assert_eq!(dirty_files(&dir), 6, "chaque fichier apparaît modifié alors que seul le droit a changé");

            assert!(fix_unreliable_filemode(&repo).unwrap());
            assert_eq!(dirty_files(&dir), 0, "plus aucun faux changement");
            // Idempotent : déjà corrigé, rien à refaire.
            assert!(!fix_unreliable_filemode(&repo).unwrap());
        }

        #[test]
        fn a_normal_repository_is_left_alone() {
            let (dir, repo) = committed_repo(6, 0);
            assert!(!fix_unreliable_filemode(&repo).unwrap());
            chmod_all(&dir, 0o644);
            assert!(!fix_unreliable_filemode(&repo).unwrap());
            let snapshot = repo.config().unwrap().snapshot().unwrap();
            assert!(snapshot.get_bool("core.filemode").unwrap_or(true), "le réglage ne doit pas changer");
        }

        #[test]
        fn a_few_executable_files_are_a_real_change_not_the_symptom() {
            let (dir, repo) = committed_repo(6, 0);
            std::fs::set_permissions(dir.path().join("f0.txt"), std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(!fix_unreliable_filemode(&repo).unwrap());
            assert_eq!(dirty_files(&dir), 1, "le vrai changement de droit reste visible");
        }

        #[test]
        fn too_few_files_prove_nothing() {
            let (dir, repo) = committed_repo(2, 0);
            chmod_all(&dir, 0o777);
            assert!(!fix_unreliable_filemode(&repo).unwrap());
        }

        #[test]
        fn files_that_are_executable_in_the_index_do_not_count() {
            // Un dépôt de scripts : 100755 dans l'index, exécutables sur le disque, comme il se doit.
            let (_dir, repo) = committed_repo(6, 6);
            assert!(!fix_unreliable_filemode(&repo).unwrap());
        }
    }

    #[test]
    fn open_existing_repo() {
        let (dir, _) = init_test_repo();
        let result = open_repo(dir.path().to_str().unwrap());
        assert!(result.is_ok());
    }

    #[test]
    fn open_missing_repo_returns_error() {
        let result = open_repo("/nonexistent/path");
        assert!(matches!(result, Err(GitError::NotFound(_))));
    }

    #[test]
    fn safe_directory_entry_matches_libgit2_format() {
        assert_eq!(
            safe_directory_entry(r"\\wsl.localhost\dev\home\me\repo\"),
            "%(prefix)///wsl.localhost/dev/home/me/repo"
        );
        assert_eq!(safe_directory_entry("/home/me/repo/"), "%(prefix)//home/me/repo");
        assert_eq!(safe_directory_entry(r"C:\work\repo"), "C:/work/repo");
    }

    #[test]
    fn add_safe_directory_skips_duplicates() {
        let dir = TempDir::new().unwrap();
        let mut config = Config::open(&dir.path().join(".gitconfig")).unwrap();
        add_safe_directory(&mut config, "C:/a").unwrap();
        add_safe_directory(&mut config, "C:/b").unwrap();
        add_safe_directory(&mut config, "C:/a").unwrap();
        let mut values = Vec::new();
        config.multivar("safe.directory", None).unwrap()
            .for_each(|e| values.push(e.value().unwrap().to_string())).unwrap();
        assert_eq!(values, ["C:/a", "C:/b"]);
    }

    #[test]
    fn repo_info_on_empty_repo_reports_unborn_branch() {
        let (_dir, repo) = init_test_repo();
        let info = repo_info(&repo).unwrap();
        assert_eq!(info.state, "clean");
        assert!(info.head_branch.is_some());
        assert!(info.head_hash.is_none());
        assert!(!info.head_detached);
    }

    #[test]
    fn set_identity_on_repo_is_read_back() {
        let (_dir, repo) = init_test_repo();
        set_identity(Some(&repo), "Alice", "alice@example.com").unwrap();
        let id = get_identity(&repo).unwrap();
        assert_eq!(id.name.as_deref(), Some("Alice"));
        assert_eq!(id.email.as_deref(), Some("alice@example.com"));
    }
}
