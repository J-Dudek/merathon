//! Worktrees : plusieurs copies de travail d'un même dépôt, chacune sur sa branche.

use std::path::{Path, PathBuf};
use git2::{BranchType, Repository, WorktreeAddOptions, WorktreeLockStatus, WorktreePruneOptions};
use serde::Serialize;
use super::error::GitError;
use super::ops::ensure_branch_name_free;

#[derive(Debug, Serialize, Clone)]
pub struct WorktreeInfo {
    /// Nom interne de git, absent pour le worktree principal.
    pub name: Option<String>,
    pub path: String,
    /// Branche extraite ; absente si HEAD est détaché ou si le dossier est introuvable.
    pub branch: Option<String>,
    pub head_hash: Option<String>,
    pub is_main: bool,
    /// Worktree depuis lequel la liste est demandée.
    pub is_current: bool,
    pub locked: bool,
    /// Faux : le dossier a été déplacé ou supprimé hors de Merathon.
    pub valid: bool,
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    let trimmed = text.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() { text.to_string() } else { trimmed.to_string() }
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Branche et commit extraits d'une copie de travail.
fn head_of(repo: &Repository) -> (Option<String>, Option<String>) {
    let Ok(head) = repo.head() else { return (None, None) };
    let branch = if repo.head_detached().unwrap_or(false) { None } else { head.shorthand().ok().map(str::to_string) };
    (branch, head.target().map(|id| id.to_string()))
}

/// Copie de travail principale ; `repo` peut être un worktree lié. Aucune pour un dépôt bare.
fn main_workdir(repo: &Repository) -> Option<PathBuf> {
    if !repo.is_worktree() {
        return repo.workdir().map(Path::to_path_buf);
    }
    Repository::open(repo.commondir()).ok()?.workdir().map(Path::to_path_buf)
}

/// Le worktree principal d'abord, puis les worktrees liés par nom.
pub fn list_worktrees(repo: &Repository) -> Result<Vec<WorktreeInfo>, GitError> {
    let current = repo.workdir();
    let is_current = |path: &Path| current.is_some_and(|c| same_dir(c, path));
    let mut list = Vec::new();
    if let Some(path) = main_workdir(repo) {
        let (branch, head_hash) = Repository::open(&path).map(|r| head_of(&r)).unwrap_or_default();
        list.push(WorktreeInfo {
            name: None,
            path: display_path(&path),
            branch,
            head_hash,
            is_main: true,
            is_current: is_current(&path),
            locked: false,
            valid: true,
        });
    }
    // libgit2 les donne dans l'ordre du dossier, qui varie.
    let names = repo.worktrees()?;
    let mut names: Vec<&str> = names.iter().flatten().flatten().collect();
    names.sort_unstable();
    for name in names {
        let wt = repo.find_worktree(name)?;
        let valid = wt.validate().is_ok();
        let (branch, head_hash) = if valid { Repository::open(wt.path()).map(|r| head_of(&r)).unwrap_or_default() } else { (None, None) };
        list.push(WorktreeInfo {
            name: Some(name.to_string()),
            path: display_path(wt.path()),
            branch,
            head_hash,
            is_main: false,
            is_current: is_current(wt.path()),
            locked: !matches!(wt.is_locked(), Ok(WorktreeLockStatus::Unlocked)),
            valid,
        });
    }
    Ok(list)
}

/// Autre worktree qui a extrait cette branche : la déplacer désynchroniserait ses fichiers.
pub(crate) fn checked_out_elsewhere(repo: &Repository, branch: &str) -> Result<Option<String>, GitError> {
    Ok(list_worktrees(repo)?.into_iter().find(|w| !w.is_current && w.branch.as_deref() == Some(branch)).map(|w| w.path))
}

/// Erreur à renvoyer si la branche est extraite dans un autre worktree.
pub(crate) fn ensure_not_checked_out_elsewhere(repo: &Repository, branch: &str) -> Result<(), GitError> {
    match checked_out_elsewhere(repo, branch)? {
        Some(path) => Err(GitError::Conflict(format!("La branche {branch} est déjà extraite dans le worktree {path}"))),
        None => Ok(()),
    }
}

/// Nom interne libre, dérivé du nom du dossier (git n'accepte ni `/` ni nom déjà pris).
fn unique_name(repo: &Repository, path: &Path) -> Result<String, GitError> {
    let base: String = path
        .file_name()
        .map(|n| n.to_string_lossy().chars().map(|c| if c.is_alphanumeric() || "-_.".contains(c) { c } else { '-' }).collect())
        .unwrap_or_default();
    let base = base.trim_start_matches('.').to_string();
    let base = if base.is_empty() { "worktree".to_string() } else { base };
    let taken = repo.worktrees()?;
    let taken: Vec<&str> = taken.iter().flatten().flatten().collect();
    if !taken.contains(&base.as_str()) {
        return Ok(base);
    }
    Ok((2..).map(|n| format!("{base}-{n}")).find(|name| !taken.contains(&name.as_str())).expect("suite infinie"))
}

/// Crée un worktree dans `path` sur `branch`, créée d'abord depuis HEAD si `create`.
pub fn add_worktree(repo: &Repository, path: &str, branch: &str, create: bool) -> Result<(), GitError> {
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err(GitError::Conflict(format!("Indique un chemin absolu pour le worktree : {path}")));
    }
    if target.exists() {
        return Err(GitError::Conflict(format!("Le dossier {path} existe déjà : choisis un autre emplacement")));
    }
    if create {
        ensure_branch_name_free(repo, branch, None)?;
        repo.branch(branch, &repo.head()?.peel_to_commit()?, false)?;
    }
    let result = (|| {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let name = unique_name(repo, target)?;
        let reference = repo.find_branch(branch, BranchType::Local)?.into_reference();
        let mut options = WorktreeAddOptions::new();
        options.reference(Some(&reference));
        repo.worktree(&name, target, Some(&options))?;
        Ok(())
    })();
    if result.is_err() && create {
        // Le worktree n'existe pas : la branche créée pour lui ne doit pas rester.
        if let Ok(mut created) = repo.find_branch(branch, BranchType::Local) {
            let _ = created.delete();
        }
    }
    result
}

/// Supprime un worktree lié, son dossier compris ; si le dossier a déjà disparu, retire seulement sa référence.
pub fn remove_worktree(repo: &Repository, name: &str) -> Result<(), GitError> {
    let wt = repo.find_worktree(name)?;
    if !matches!(wt.is_locked()?, WorktreeLockStatus::Unlocked) {
        return Err(GitError::Conflict(format!("Le worktree {name} est verrouillé : déverrouille-le avec git worktree unlock")));
    }
    if repo.workdir().is_some_and(|c| same_dir(c, wt.path())) {
        return Err(GitError::Conflict("Impossible de supprimer le worktree affiché : ouvre d'abord un autre worktree".into()));
    }
    wt.prune(Some(WorktreePruneOptions::new().valid(true).working_tree(true)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use git2::Signature;
    use tempfile::TempDir;

    fn base_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let main = dir.path().join("main");
        let repo = Repository::init(&main).unwrap();
        fs::write(main.join("file.txt"), "v1\n").unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("file.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();
        }
        (dir, repo)
    }

    fn path_in(dir: &TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().to_string()
    }

    #[test]
    fn creates_a_worktree_on_a_new_branch_and_lists_it() {
        let (dir, repo) = base_repo();
        let path = path_in(&dir, "wt/feature");
        add_worktree(&repo, &path, "feature/x", true).unwrap();
        assert!(dir.path().join("wt/feature/file.txt").exists());

        let list = list_worktrees(&repo).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].is_main && list[0].is_current);
        // Même dossier, sous sa forme normalisée (sous Windows : `/`, sans nom court 8.3).
        assert!(same_dir(Path::new(&list[1].path), Path::new(&path)), "{} / {path}", list[1].path);
        assert_eq!(list[1].branch.as_deref(), Some("feature/x"));
        assert!(list[1].valid && !list[1].is_main && !list[1].is_current);

        // Vue depuis le worktree lié : même liste, seul le worktree courant change.
        let linked = list_worktrees(&Repository::open(&path).unwrap()).unwrap();
        assert!(linked[0].is_main && !linked[0].is_current);
        assert!(linked[1].is_current);
    }

    /// Le vrai `git` doit reconnaître et pouvoir retirer ce que libgit2 a créé.
    #[test]
    fn git_command_line_understands_the_worktree() {
        let git = |dir: &Path, args: &[&str]| {
            let out = std::process::Command::new("git").current_dir(dir).args(args).output().unwrap();
            assert!(out.status.success(), "git {args:?} : {}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).to_string()
        };
        let (dir, repo) = base_repo();
        let path = path_in(&dir, "wt");
        add_worktree(&repo, &path, "feat", true).unwrap();
        assert!(git(&dir.path().join("main"), &["worktree", "list"]).contains("[feat]"));
        assert_eq!(git(&dir.path().join("wt"), &["status", "--porcelain"]), "");
        // Et l'inverse : un worktree créé par git apparaît dans la liste.
        git(&dir.path().join("main"), &["worktree", "add", "-q", "-b", "cli", "../cli"]);
        assert!(list_worktrees(&repo).unwrap().iter().any(|w| w.branch.as_deref() == Some("cli")));
    }

    #[test]
    fn checks_out_an_existing_branch() {
        let (dir, repo) = base_repo();
        crate::git::create_branch(&repo, "side", "HEAD").unwrap();
        add_worktree(&repo, &path_in(&dir, "side"), "side", false).unwrap();
        assert_eq!(list_worktrees(&repo).unwrap()[1].branch.as_deref(), Some("side"));
    }

    #[test]
    fn refuses_a_branch_already_checked_out_and_an_existing_folder() {
        let (dir, repo) = base_repo();
        let head = repo.head().unwrap().shorthand().unwrap().to_string();
        assert!(add_worktree(&repo, &path_in(&dir, "other"), &head, false).is_err());
        assert!(!dir.path().join("other").exists() || fs::read_dir(dir.path().join("other")).unwrap().next().is_none());

        fs::create_dir(dir.path().join("taken")).unwrap();
        let err = add_worktree(&repo, &path_in(&dir, "taken"), "new", true).unwrap_err();
        assert!(err.to_string().contains("existe déjà"));
        assert!(repo.find_branch("new", BranchType::Local).is_err());
    }

    #[test]
    fn explains_a_branch_name_nested_in_another_one() {
        let (dir, repo) = base_repo();
        crate::git::create_branch(&repo, "toto", "HEAD").unwrap();
        let err = add_worktree(&repo, &path_in(&dir, "parent/toto-a5"), "toto/a5", true).unwrap_err();
        assert!(err.to_string().contains("conflit avec la branche toto"), "{err}");
        assert!(!dir.path().join("parent").exists());
    }

    #[test]
    fn refuses_a_relative_path() {
        let (_dir, repo) = base_repo();
        assert!(add_worktree(&repo, "relatif/chemin", "new", true).is_err());
        assert!(repo.find_branch("new", BranchType::Local).is_err());
    }

    #[test]
    fn gives_two_folders_with_the_same_name_distinct_names() {
        let (dir, repo) = base_repo();
        add_worktree(&repo, &path_in(&dir, "a/same"), "one", true).unwrap();
        add_worktree(&repo, &path_in(&dir, "b/same"), "two", true).unwrap();
        let names: Vec<_> = list_worktrees(&repo).unwrap().into_iter().filter_map(|w| w.name).collect();
        assert_eq!(names, ["same", "same-2"]);
    }

    #[test]
    fn removes_the_folder_and_keeps_the_branch() {
        let (dir, repo) = base_repo();
        let path = path_in(&dir, "gone");
        add_worktree(&repo, &path, "feat", true).unwrap();
        fs::write(dir.path().join("gone/untracked.txt"), "x").unwrap();
        remove_worktree(&repo, "gone").unwrap();
        assert!(!dir.path().join("gone").exists());
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
        assert!(repo.find_branch("feat", BranchType::Local).is_ok());
    }

    #[test]
    fn cleans_up_a_worktree_whose_folder_has_disappeared() {
        let (dir, repo) = base_repo();
        add_worktree(&repo, &path_in(&dir, "lost"), "feat", true).unwrap();
        fs::remove_dir_all(dir.path().join("lost")).unwrap();
        let list = list_worktrees(&repo).unwrap();
        assert!(!list[1].valid);
        remove_worktree(&repo, "lost").unwrap();
        assert_eq!(list_worktrees(&repo).unwrap().len(), 1);
    }

    #[test]
    fn refuses_to_remove_a_locked_or_displayed_worktree() {
        let (dir, repo) = base_repo();
        let path = path_in(&dir, "wt");
        add_worktree(&repo, &path, "feat", true).unwrap();
        let linked = Repository::open(&path).unwrap();
        assert!(remove_worktree(&linked, "wt").is_err());
        repo.find_worktree("wt").unwrap().lock(None).unwrap();
        assert!(list_worktrees(&repo).unwrap()[1].locked);
        assert!(remove_worktree(&repo, "wt").is_err());
        assert!(dir.path().join("wt").exists());
    }

    #[test]
    fn checkout_of_a_branch_used_elsewhere_leaves_the_files_untouched() {
        let (dir, repo) = base_repo();
        let path = path_in(&dir, "wt");
        add_worktree(&repo, &path, "feat", true).unwrap();
        // La branche feat diverge : un checkout réécrirait file.txt avant l'échec de set_head.
        let linked = Repository::open(&path).unwrap();
        fs::write(dir.path().join("wt/file.txt"), "v2\n").unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let mut index = linked.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
        index.write().unwrap();
        let tree = linked.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = linked.head().unwrap().peel_to_commit().unwrap();
        linked.commit(Some("HEAD"), &sig, &sig, "v2", &tree, &[&parent]).unwrap();

        let err = crate::git::checkout_branch(&repo, "feat").unwrap_err();
        assert!(err.to_string().contains("déjà extraite"), "{err}");
        assert_eq!(fs::read_to_string(dir.path().join("main/file.txt")).unwrap(), "v1\n");
    }

    #[test]
    fn does_not_move_a_branch_used_elsewhere() {
        let (dir, repo) = base_repo();
        add_worktree(&repo, &path_in(&dir, "wt"), "feat", true).unwrap();
        let before = repo.find_branch("feat", BranchType::Local).unwrap().get().target();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "next", &head.tree().unwrap(), &[&head]).unwrap();

        let head_name = repo.head().unwrap().shorthand().unwrap().to_string();
        assert!(crate::git::fast_forward_branch(&repo, "feat", &head_name).is_err());
        assert_eq!(repo.find_branch("feat", BranchType::Local).unwrap().get().target(), before);
    }
}
