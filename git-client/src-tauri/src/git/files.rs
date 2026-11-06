//! Fichiers de la copie de travail, pour les parcourir et les modifier dans l'application (sur Android, aucun autre
//! éditeur ne peut ouvrir le dossier privé où sont les dépôts).
//!
//! Seuls les fichiers texte UTF-8 de taille raisonnable s'ouvrent ; les chemins passent par `checked_path` (pas de `..`,
//! ni de `.git`, ni de lien symbolique vers l'extérieur).

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use git2::{Repository, StatusOptions};

use super::error::GitError;
use super::paths::checked_path;

/// Au-delà, le fichier n'est pas ouvert : une zone de texte devient inutilisable bien avant.
pub const MAX_EDITABLE_BYTES: u64 = 512 * 1024;

fn workdir(repo: &Repository) -> Result<&Path, GitError> {
    repo.workdir().ok_or_else(|| GitError::NotFound("bare repository".into()))
}

/// Fichiers suivis et non suivis (hors `.gitignore`) présents sur le disque, triés. Les sous-modules sont exclus.
pub fn list_files(repo: &Repository) -> Result<Vec<String>, GitError> {
    let root = workdir(repo)?;
    let mut files = BTreeSet::new();
    for entry in repo.index()?.iter() {
        // 0o160000 : lien vers un sous-module, pas un fichier.
        if entry.mode == 0o160000 {
            continue;
        }
        let path = String::from_utf8_lossy(&entry.path).into_owned();
        if root.join(&path).is_file() {
            files.insert(path);
        }
    }
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false).exclude_submodules(true);
    for status in repo.statuses(Some(&mut options))?.iter() {
        if status.status().is_wt_new() {
            if let Ok(path) = status.path() {
                if root.join(path).is_file() {
                    files.insert(path.to_string());
                }
            }
        }
    }
    Ok(files.into_iter().collect())
}

/// Contenu d'un fichier texte de la copie de travail.
pub fn read_file(repo: &Repository, rel: &str) -> Result<String, GitError> {
    let full = checked_path(workdir(repo)?, rel)?;
    let meta = fs::metadata(&full).map_err(|e| GitError::NotFound(e.to_string()))?;
    if !meta.is_file() {
        return Err(GitError::Other(tr!("{rel} n'est pas un fichier", "{rel} is not a file")));
    }
    if meta.len() > MAX_EDITABLE_BYTES {
        return Err(GitError::Other(tr!(
            "{rel} est trop gros pour être modifié ici ({} Kio au plus)",
            "{rel} is too large to be edited here ({} KiB at most)",
            MAX_EDITABLE_BYTES / 1024
        )));
    }
    let bytes = fs::read(&full).map_err(|e| GitError::NotFound(e.to_string()))?;
    if bytes.contains(&0) {
        return Err(GitError::Other(tr!("{rel} est un fichier binaire : il ne peut pas être modifié ici", "{rel} is a binary file: it cannot be edited here")));
    }
    String::from_utf8(bytes).map_err(|_| {
        GitError::Other(tr!("{rel} n'est pas encodé en UTF-8 : il ne peut pas être modifié ici", "{rel} is not UTF-8 encoded: it cannot be edited here"))
    })
}

/// Écrit un fichier de la copie de travail. `create` : nouveau fichier (refusé s'il existe déjà), dossiers créés au besoin.
pub fn write_file(repo: &Repository, rel: &str, content: &str, create: bool) -> Result<(), GitError> {
    let full = checked_path(workdir(repo)?, rel)?;
    if create {
        if full.symlink_metadata().is_ok() {
            return Err(GitError::Other(tr!("{rel} existe déjà", "{rel} already exists")));
        }
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
    } else if !full.is_file() {
        return Err(GitError::NotFound(tr!("{rel} n'existe plus", "{rel} no longer exists")));
    }
    fs::write(&full, content)?;
    Ok(())
}

/// Supprime un fichier de la copie de travail (le retrait apparaît ensuite dans les modifications à commiter).
pub fn delete_file(repo: &Repository, rel: &str) -> Result<(), GitError> {
    let full = checked_path(workdir(repo)?, rel)?;
    if !full.symlink_metadata().is_ok_and(|m| !m.is_dir()) {
        return Err(GitError::NotFound(tr!("{rel} n'existe plus", "{rel} no longer exists")));
    }
    fs::remove_file(&full)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn repo_with_files() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("README.md"), "# Projet\n").unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(dir.path().join(".gitignore"), "build/\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("README.md")).unwrap();
            index.add_path(Path::new("src/main.rs")).unwrap();
            index.add_path(Path::new(".gitignore")).unwrap();
            index.write().unwrap();
        }
        fs::create_dir_all(dir.path().join("build")).unwrap();
        fs::write(dir.path().join("build/out.txt"), "ignoré").unwrap();
        fs::create_dir_all(dir.path().join("notes/2026")).unwrap();
        fs::write(dir.path().join("notes/2026/idee.txt"), "non suivi").unwrap();
        (dir, repo)
    }

    #[test]
    fn lists_tracked_and_untracked_files_but_not_ignored_ones() {
        let (dir, repo) = repo_with_files();
        fs::remove_file(dir.path().join("README.md")).unwrap();
        assert_eq!(list_files(&repo).unwrap(), vec![".gitignore", "notes/2026/idee.txt", "src/main.rs"]);
    }

    #[test]
    fn reads_writes_creates_and_deletes_text_files() {
        let (dir, repo) = repo_with_files();
        assert_eq!(read_file(&repo, "src/main.rs").unwrap(), "fn main() {}\n");

        write_file(&repo, "src/main.rs", "fn main() {\n    println!(\"é\");\n}\n", false).unwrap();
        assert!(read_file(&repo, "src/main.rs").unwrap().contains('é'));

        write_file(&repo, "docs/guide/usage.md", "# Usage\n", true).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("docs/guide/usage.md")).unwrap(), "# Usage\n");
        assert!(write_file(&repo, "docs/guide/usage.md", "x", true).unwrap_err().to_string().contains("existe déjà"));
        assert!(write_file(&repo, "absent.txt", "x", false).is_err(), "une modification ne crée pas de fichier");

        delete_file(&repo, "docs/guide/usage.md").unwrap();
        assert!(!dir.path().join("docs/guide/usage.md").exists());
        assert!(delete_file(&repo, "docs/guide/usage.md").is_err());
        assert!(delete_file(&repo, "docs").is_err(), "jamais un dossier");
    }

    #[test]
    fn refuses_binary_huge_and_non_utf8_files() {
        let (dir, repo) = repo_with_files();
        fs::write(dir.path().join("logo.png"), [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        assert!(read_file(&repo, "logo.png").unwrap_err().to_string().contains("binaire"));
        fs::write(dir.path().join("latin1.txt"), [b'c', b'a', b'f', 0xe9]).unwrap();
        assert!(read_file(&repo, "latin1.txt").unwrap_err().to_string().contains("UTF-8"));
        fs::write(dir.path().join("gros.txt"), "a".repeat(MAX_EDITABLE_BYTES as usize + 1)).unwrap();
        assert!(read_file(&repo, "gros.txt").unwrap_err().to_string().contains("trop gros"));
        assert!(read_file(&repo, "src").is_err());
    }

    #[test]
    fn stays_inside_the_working_copy() {
        let (_dir, repo) = repo_with_files();
        for bad in ["../dehors.txt", "/etc/passwd", ".git/config", ".git/hooks/pre-commit"] {
            assert!(read_file(&repo, bad).is_err(), "{bad}");
            assert!(write_file(&repo, bad, "x", true).is_err(), "{bad}");
            assert!(delete_file(&repo, bad).is_err(), "{bad}");
        }
    }
}
