use std::cell::RefCell;
use git2::{Diff, DiffOptions, Repository};
use serde::Serialize;
use super::error::GitError;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Serialize, Clone)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
    pub is_binary: bool,
}

pub fn get_diff(repo: &Repository, file_path: &str, staged: bool) -> Result<FileDiff, GitError> {
    let diff = workdir_file_diff(repo, file_path, staged)?;
    collect_file_diff(&diff, file_path)
}

/// Diff d'un fichier de la copie de travail : HEAD → index si `staged`, sinon index → copie de travail.
/// Utilisé à la fois pour l'affichage et pour l'indexation partielle : les index de lignes coïncident.
pub(crate) fn workdir_file_diff<'r>(repo: &'r Repository, file_path: &str, staged: bool) -> Result<Diff<'r>, GitError> {
    let mut opts = DiffOptions::new();
    opts.pathspec(file_path).disable_pathspec_match(true);

    let diff = if staged {
        let head_tree = repo
            .head()
            .ok()
            .and_then(|r| r.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
    } else {
        // Sans ces options, un fichier non suivi n'a aucun contenu dans le diff.
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };
    Ok(diff)
}

/// Diff d'un fichier introduit par un commit (par rapport à son premier parent).
pub fn get_commit_file_diff(repo: &Repository, hash: &str, file_path: &str) -> Result<FileDiff, GitError> {
    let commit = repo.revparse_single(hash)?.peel_to_commit()?;
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;

    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;

    collect_file_diff(&diff, file_path)
}

/// Diff d'un fichier entre deux commits (base → tête d'une comparaison de branches).
pub fn get_compare_file_diff(repo: &Repository, base: &str, head: &str, file_path: &str) -> Result<FileDiff, GitError> {
    let base_tree = repo.revparse_single(base)?.peel_to_tree()?;
    let head_tree = repo.revparse_single(head)?.peel_to_tree()?;
    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);
    let diff = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut opts))?;
    collect_file_diff(&diff, file_path)
}

fn collect_file_diff(diff: &Diff, file_path: &str) -> Result<FileDiff, GitError> {
    let hunks: RefCell<Vec<DiffHunk>> = RefCell::new(Vec::new());
    let is_binary: RefCell<bool> = RefCell::new(false);

    diff.foreach(
        &mut |_delta, _progress| true,
        Some(&mut |_delta, _| {
            *is_binary.borrow_mut() = true;
            true
        }),
        Some(&mut |_delta, hunk| {
            let header = std::str::from_utf8(hunk.header()).unwrap_or("").trim_end().to_string();
            hunks.borrow_mut().push(DiffHunk {
                header,
                old_start: hunk.old_start(),
                new_start: hunk.new_start(),
                lines: Vec::new(),
            });
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            let kind = match line.origin() {
                '+' => DiffLineKind::Added,
                '-' => DiffLineKind::Removed,
                ' ' => DiffLineKind::Context,
                // Marqueurs "\\ No newline at end of file" et en-têtes : ignorés.
                _ => return true,
            };
            let content = std::str::from_utf8(line.content()).unwrap_or("").trim_end().to_string();
            if let Some(hunk) = hunks.borrow_mut().last_mut() {
                hunk.lines.push(DiffLine {
                    kind,
                    content,
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                });
            }
            true
        }),
    )?;

    Ok(FileDiff {
        path: file_path.to_string(),
        hunks: hunks.into_inner(),
        is_binary: is_binary.into_inner(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use git2::{Repository, Signature};

    fn make_repo_with_commit(content: &str) -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@test.com").unwrap();

        fs::write(dir.path().join("file.txt"), content).unwrap();

        let sig = Signature::now("Test", "test@test.com").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("file.txt")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }

        (dir, repo)
    }

    #[test]
    fn diff_unstaged_modified_file() {
        let (dir, repo) = make_repo_with_commit("hello\n");
        fs::write(dir.path().join("file.txt"), "hello\nworld\n").unwrap();

        let diff = get_diff(&repo, "file.txt", false).unwrap();
        assert!(!diff.is_binary);
        assert!(!diff.hunks.is_empty());

        let added: Vec<_> = diff.hunks[0].lines.iter()
            .filter(|l| l.kind == DiffLineKind::Added)
            .collect();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].content, "world");
    }

    #[test]
    fn diff_staged_file() {
        let (dir, repo) = make_repo_with_commit("hello\n");
        fs::write(dir.path().join("file.txt"), "hello\nworld\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("file.txt")).unwrap();
            index.write().unwrap();
        }

        let diff = get_diff(&repo, "file.txt", true).unwrap();
        assert!(!diff.hunks.is_empty());
        let added: Vec<_> = diff.hunks[0].lines.iter()
            .filter(|l| l.kind == DiffLineKind::Added)
            .collect();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].content, "world");
    }

    #[test]
    fn diff_unchanged_file_has_no_hunks() {
        let (_dir, repo) = make_repo_with_commit("hello\n");
        let diff = get_diff(&repo, "file.txt", false).unwrap();
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn diff_includes_line_numbers() {
        let (dir, repo) = make_repo_with_commit("line1\nline2\n");
        fs::write(dir.path().join("file.txt"), "line1\nline2\nline3\n").unwrap();
        let diff = get_diff(&repo, "file.txt", false).unwrap();
        let added = diff.hunks[0].lines.iter().find(|l| l.kind == DiffLineKind::Added).unwrap();
        assert!(added.new_lineno.is_some());
    }

    #[test]
    fn diff_untracked_file_shows_content() {
        let (dir, repo) = make_repo_with_commit("hello\n");
        fs::write(dir.path().join("new.txt"), "brand new\n").unwrap();
        let diff = get_diff(&repo, "new.txt", false).unwrap();
        assert_eq!(diff.hunks[0].lines[0].content, "brand new");
    }

    #[test]
    fn commit_file_diff_against_parent() {
        let (dir, repo) = make_repo_with_commit("hello\n");
        fs::write(dir.path().join("file.txt"), "hello\nagain\n").unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("file.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let oid = repo.commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent]).unwrap();

        let diff = get_commit_file_diff(&repo, &oid.to_string(), "file.txt").unwrap();
        let added: Vec<_> = diff.hunks[0].lines.iter().filter(|l| l.kind == DiffLineKind::Added).collect();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].content, "again");
    }
}
