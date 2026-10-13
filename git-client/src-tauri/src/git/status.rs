use std::path::Path;
use git2::{build::CheckoutBuilder, IndexAddOption, Repository, Status, StatusOptions};
use serde::Serialize;
use super::error::GitError;
use super::lfs;
use super::paths::{checked_path, validate_all};
use super::submodule::is_submodule;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatusKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Serialize, Clone)]
pub struct FileStatus {
    pub path: String,
    pub status: FileStatusKind,
    pub staged: bool,
}

pub fn get_status(repo: &Repository) -> Result<Vec<FileStatus>, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true).renames_head_to_index(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let files = statuses
        .iter()
        .flat_map(|entry| match entry.path() {
            Ok(path) => status_to_file_status(path.to_string(), entry.status()),
            Err(_) => Vec::new(),
        })
        .collect();

    Ok(files)
}

/// Un fichier modifié, indexé puis re-modifié apparaît à la fois côté indexé et côté non indexé.
fn status_to_file_status(path: String, s: Status) -> Vec<FileStatus> {
    if s.contains(Status::CONFLICTED) {
        return vec![FileStatus { path, status: FileStatusKind::Conflicted, staged: false }];
    }

    let staged_kind = if s.contains(Status::INDEX_NEW) {
        Some(FileStatusKind::Added)
    } else if s.contains(Status::INDEX_MODIFIED) || s.contains(Status::INDEX_TYPECHANGE) {
        Some(FileStatusKind::Modified)
    } else if s.contains(Status::INDEX_DELETED) {
        Some(FileStatusKind::Deleted)
    } else if s.contains(Status::INDEX_RENAMED) {
        Some(FileStatusKind::Renamed)
    } else {
        None
    };

    let wt_kind = if s.contains(Status::WT_NEW) {
        Some(FileStatusKind::Untracked)
    } else if s.contains(Status::WT_MODIFIED) || s.contains(Status::WT_TYPECHANGE) {
        Some(FileStatusKind::Modified)
    } else if s.contains(Status::WT_DELETED) {
        Some(FileStatusKind::Deleted)
    } else if s.contains(Status::WT_RENAMED) {
        Some(FileStatusKind::Renamed)
    } else {
        None
    };

    let mut out = Vec::new();
    if let Some(status) = staged_kind {
        out.push(FileStatus { path: path.clone(), status, staged: true });
    }
    if let Some(status) = wt_kind {
        out.push(FileStatus { path, status, staged: false });
    }
    out
}

pub fn stage_paths(repo: &Repository, paths: &[String]) -> Result<(), GitError> {
    validate_all(paths)?;
    let workdir = repo.workdir().ok_or_else(|| GitError::Other("dépôt bare".into()))?;
    // Fichiers LFS : `git add` applique le filtre et n'indexe que le pointeur.
    let (lfs_paths, paths): (Vec<String>, Vec<String>) = paths.iter().cloned().partition(|p| lfs::is_lfs_path(repo, p));
    if !lfs_paths.is_empty() {
        lfs::git_add(repo, &lfs_paths)?;
    }
    let mut index = repo.index()?;
    index.read(true)?;
    for p in &paths {
        let rel = Path::new(p);
        if is_submodule(repo, p) {
            // Un sous-module s'indexe par son commit extrait, pas comme un fichier.
            repo.find_submodule(p)?.add_to_index(true)?;
            index.read(true)?;
            continue;
        }
        // add_path échoue sur un fichier supprimé : on retire alors l'entrée de l'index.
        if workdir.join(rel).exists() {
            index.add_path(rel)?;
        } else {
            index.remove_path(rel)?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn stage_all(repo: &Repository) -> Result<(), GitError> {
    // Les fichiers LFS passent par `git add` (filtre LFS) ; tout le reste par libgit2, qui
    // n'exécute aucun filtre externe défini par le dépôt.
    let lfs_paths: Vec<String> = if lfs::uses_lfs(repo) {
        get_status(repo)?
            .into_iter()
            .filter(|f| !f.staged && lfs::is_lfs_path(repo, &f.path))
            .map(|f| f.path)
            .collect()
    } else {
        Vec::new()
    };
    let mut skip_lfs = |path: &Path, _: &[u8]| -> i32 {
        i32::from(lfs::is_lfs_path(repo, &path.to_string_lossy()))
    };
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, Some(&mut skip_lfs))?;
    index.update_all(["*"].iter(), Some(&mut skip_lfs))?;
    index.write()?;
    if !lfs_paths.is_empty() {
        lfs::git_add(repo, &lfs_paths)?;
    }
    Ok(())
}

pub fn unstage_paths(repo: &Repository, paths: &[String]) -> Result<(), GitError> {
    validate_all(paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    match repo.head().ok().and_then(|r| r.peel_to_commit().ok()) {
        Some(commit) => repo.reset_default(Some(commit.as_object()), paths)?,
        None => {
            let mut index = repo.index()?;
            for p in paths {
                index.remove_path(Path::new(p))?;
            }
            index.write()?;
        }
    }
    Ok(())
}

pub fn unstage_all(repo: &Repository) -> Result<(), GitError> {
    let staged: Vec<String> = get_status(repo)?
        .into_iter()
        .filter(|f| f.staged)
        .map(|f| f.path)
        .collect();
    unstage_paths(repo, &staged)
}

/// Annule les modifications non indexées d'un fichier (supprime le fichier s'il est non suivi).
pub fn discard_paths(repo: &Repository, paths: &[String]) -> Result<(), GitError> {
    validate_all(paths)?;
    let workdir = repo.workdir().ok_or_else(|| GitError::Other("dépôt bare".into()))?;
    let mut to_checkout = Vec::new();
    for p in paths {
        if is_submodule(repo, p) {
            // Revient au commit enregistré dans le dépôt parent.
            repo.find_submodule(p)?.update(false, None)?;
            continue;
        }
        let status = repo.status_file(Path::new(p)).unwrap_or(Status::CURRENT);
        if !status.contains(Status::WT_NEW) && lfs::is_lfs_path(repo, p) {
            // checkout_index écrirait le pointeur LFS au lieu du contenu.
            lfs::git_checkout_paths(repo, std::slice::from_ref(p))?;
            continue;
        }
        if status.contains(Status::WT_NEW) {
            let full = checked_path(workdir, p)?;
            if full.is_dir() {
                std::fs::remove_dir_all(full)?;
            } else {
                std::fs::remove_file(full)?;
            }
        } else {
            to_checkout.push(p.clone());
        }
    }
    if !to_checkout.is_empty() {
        let mut cb = CheckoutBuilder::new();
        cb.force();
        for p in &to_checkout {
            cb.path(p);
        }
        // Restaure depuis l'index : les modifications indexées sont conservées.
        repo.checkout_index(None, Some(&mut cb))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        (dir, repo)
    }

    #[test]
    fn empty_repo_has_no_status() {
        let (_dir, repo) = make_repo();
        let status = get_status(&repo).unwrap();
        assert!(status.is_empty());
    }

    #[test]
    fn untracked_file_appears_in_status() {
        let (dir, repo) = make_repo();
        fs::write(dir.path().join("file.txt"), "hello").unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].status, FileStatusKind::Untracked);
        assert!(!status[0].staged);
    }

    #[test]
    fn staged_file_appears_as_staged() {
        let (dir, repo) = make_repo();
        let file_path = dir.path().join("file.txt");
        fs::write(&file_path, "hello").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("file.txt")).unwrap();
        index.write().unwrap();

        let status = get_status(&repo).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].status, FileStatusKind::Added);
        assert!(status[0].staged);
    }

    fn commit_all(repo: &Repository, msg: &str) {
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap();
    }

    #[test]
    fn partially_staged_file_appears_twice() {
        let (dir, repo) = make_repo();
        fs::write(dir.path().join("f.txt"), "v1").unwrap();
        commit_all(&repo, "init");
        fs::write(dir.path().join("f.txt"), "v2").unwrap();
        stage_paths(&repo, &["f.txt".into()]).unwrap();
        fs::write(dir.path().join("f.txt"), "v3").unwrap();

        let status = get_status(&repo).unwrap();
        assert_eq!(status.len(), 2);
        assert!(status.iter().any(|f| f.staged));
        assert!(status.iter().any(|f| !f.staged));
    }

    #[test]
    fn stage_deleted_file() {
        let (dir, repo) = make_repo();
        fs::write(dir.path().join("f.txt"), "v1").unwrap();
        commit_all(&repo, "init");
        fs::remove_file(dir.path().join("f.txt")).unwrap();

        stage_paths(&repo, &["f.txt".into()]).unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status[0].status, FileStatusKind::Deleted);
        assert!(status[0].staged);
    }

    #[test]
    fn stage_all_then_unstage_all() {
        let (dir, repo) = make_repo();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        fs::write(dir.path().join("b.txt"), "b").unwrap();
        stage_all(&repo).unwrap();
        assert!(get_status(&repo).unwrap().iter().all(|f| f.staged));
        unstage_all(&repo).unwrap();
        assert!(get_status(&repo).unwrap().iter().all(|f| !f.staged));
    }

    #[test]
    fn discard_restores_modified_and_removes_untracked() {
        let (dir, repo) = make_repo();
        fs::write(dir.path().join("f.txt"), "v1").unwrap();
        commit_all(&repo, "init");
        fs::write(dir.path().join("f.txt"), "changed").unwrap();
        fs::write(dir.path().join("junk.txt"), "junk").unwrap();

        discard_paths(&repo, &["f.txt".into(), "junk.txt".into()]).unwrap();

        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "v1");
        assert!(!dir.path().join("junk.txt").exists());
        assert!(get_status(&repo).unwrap().is_empty());
    }
}
