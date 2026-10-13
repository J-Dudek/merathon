use git2::{build::CheckoutBuilder, AnnotatedCommit, MergeOptions, Repository, ResetType};
use serde::Serialize;
use super::error::GitError;
use super::paths::{checked_path, validate_rel};
use super::repository::signature;

#[derive(Debug, Serialize)]
pub struct MergeResult {
    pub conflicted_files: Vec<String>,
    pub success: bool,
}

/// Résout un nom de branche locale, de branche distante ou une révision quelconque.
pub(crate) fn resolve_annotated<'r>(repo: &'r Repository, name: &str) -> Result<AnnotatedCommit<'r>, GitError> {
    if let Ok(branch) = repo.find_branch(name, git2::BranchType::Local) {
        return Ok(repo.reference_to_annotated_commit(branch.get())?);
    }
    if let Ok(branch) = repo.find_branch(name, git2::BranchType::Remote) {
        return Ok(repo.reference_to_annotated_commit(branch.get())?);
    }
    let commit = repo.revparse_single(name)?.peel_to_commit()?;
    Ok(repo.find_annotated_commit(commit.id())?)
}

pub fn conflicted_paths(repo: &Repository) -> Result<Vec<String>, GitError> {
    let index = repo.index()?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let paths = index
        .conflicts()?
        .filter_map(|c| c.ok())
        .filter_map(|c| c.our.or(c.their).or(c.ancestor))
        .filter_map(|e| String::from_utf8(e.path).ok())
        .collect();
    Ok(paths)
}

pub fn merge_branch(repo: &Repository, branch_name: &str) -> Result<MergeResult, GitError> {
    let annotated = resolve_annotated(repo, branch_name)?;
    merge_annotated(repo, &annotated, branch_name)
}

pub(crate) fn merge_annotated(repo: &Repository, annotated: &AnnotatedCommit, label: &str) -> Result<MergeResult, GitError> {
    let (analysis, _) = repo.merge_analysis(&[annotated])?;

    if analysis.is_up_to_date() {
        return Ok(MergeResult { conflicted_files: vec![], success: true });
    }

    if analysis.is_fast_forward() {
        let target = repo.find_commit(annotated.id())?;
        // Checkout "safe" d'abord : on ne déplace la branche que si la copie de travail le permet.
        repo.checkout_tree(target.as_object(), Some(CheckoutBuilder::default().safe()))?;
        let mut head = repo.head()?;
        head.set_target(target.id(), &format!("merge {label}: fast-forward"))?;
        return Ok(MergeResult { conflicted_files: vec![], success: true });
    }

    let mut merge_opts = MergeOptions::new();
    merge_opts.fail_on_conflict(false);
    repo.merge(&[annotated], Some(&mut merge_opts), Some(CheckoutBuilder::default().safe()))?;

    let conflicted = conflicted_paths(repo)?;
    if !conflicted.is_empty() {
        // Le dépôt reste en état MERGING : l'utilisateur résout puis commit.
        return Ok(MergeResult { conflicted_files: conflicted, success: false });
    }

    let head_name = repo.head()?.shorthand().unwrap_or("HEAD").to_string();
    let message = format!("Merge branch '{label}' into {head_name}");
    let sig = signature(repo)?;
    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head_commit = repo.head()?.peel_to_commit()?;
    let other = repo.find_commit(annotated.id())?;
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&head_commit, &other])?;
    repo.cleanup_state()?;

    Ok(MergeResult { conflicted_files: vec![], success: true })
}

/// Abandonne un merge / cherry-pick / revert en cours.
pub fn abort_merge(repo: &Repository) -> Result<(), GitError> {
    let head = repo.head()?.peel_to_commit()?;
    repo.reset(head.as_object(), ResetType::Hard, None)?;
    repo.cleanup_state()?;
    Ok(())
}

pub fn get_conflict_content(repo: &Repository, file_path: &str) -> Result<String, GitError> {
    let workdir = repo.workdir().ok_or_else(|| GitError::NotFound("bare repository".into()))?;
    let full_path = checked_path(workdir, file_path)?;
    std::fs::read_to_string(&full_path)
        .map_err(|e| GitError::NotFound(e.to_string()))
}

pub fn resolve_conflict(repo: &Repository, file_path: &str, content: &str) -> Result<(), GitError> {
    let workdir = repo.workdir().ok_or_else(|| GitError::NotFound("bare repository".into()))?;
    std::fs::write(checked_path(workdir, file_path)?, content)
        .map_err(|e| GitError::NotFound(e.to_string()))?;

    let mut index = repo.index()?;
    validate_rel(file_path)?;
    index.add_path(std::path::Path::new(file_path))?;
    index.write()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use git2::{Repository, Signature};

    fn base_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@test.com").unwrap();
        // Fins de ligne LF même si le git du système a core.autocrlf=true (runners Windows)
        cfg.set_bool("core.autocrlf", false).unwrap();

        fs::write(dir.path().join("file.txt"), "line1\nline2\n").unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("file.txt")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();
        }
        (dir, repo)
    }

    #[test]
    fn merge_up_to_date_branch_succeeds() {
        let (_dir, repo) = base_repo();
        // Create a branch pointing to HEAD
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();

        // Checkout feature, add commit, come back
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force())).unwrap();
        repo.set_head("refs/heads/master").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force())).unwrap();

        let result = merge_branch(&repo, "feature").unwrap();
        assert!(result.success);
        assert!(result.conflicted_files.is_empty());
    }

    #[test]
    fn resolve_conflict_writes_and_stages_file() {
        let (dir, repo) = base_repo();
        let file = dir.path().join("new.txt");
        fs::write(&file, "resolved content\n").unwrap();

        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("new.txt")).unwrap();
            index.write().unwrap();
        }

        resolve_conflict(&repo, "new.txt", "final content\n").unwrap();
        let content = fs::read_to_string(&file).unwrap();
        assert_eq!(content, "final content\n");
    }

    #[test]
    fn get_conflict_content_reads_file() {
        let (dir, repo) = base_repo();
        fs::write(dir.path().join("file.txt"), "conflict\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n").unwrap();
        let content = get_conflict_content(&repo, "file.txt").unwrap();
        assert!(content.contains("<<<<<<<"));
    }

    fn commit_on(repo: &Repository, dir: &TempDir, file: &str, content: &str, msg: &str) {
        fs::write(dir.path().join(file), content).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent]).unwrap();
    }

    fn switch(repo: &Repository, branch: &str) {
        repo.set_head(&format!("refs/heads/{branch}")).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force())).unwrap();
    }

    #[test]
    fn diverged_merge_creates_merge_commit() {
        let (dir, repo) = base_repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();
        commit_on(&repo, &dir, "main.txt", "m", "on master");
        switch(&repo, "feature");
        commit_on(&repo, &dir, "feat.txt", "f", "on feature");
        switch(&repo, "master");

        let result = merge_branch(&repo, "feature").unwrap();
        assert!(result.success);
        let merge = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(merge.parent_count(), 2);
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert!(dir.path().join("feat.txt").exists());
    }

    #[test]
    fn conflicting_merge_leaves_merging_state_then_abort() {
        let (dir, repo) = base_repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();
        commit_on(&repo, &dir, "file.txt", "master side\n", "master edit");
        switch(&repo, "feature");
        commit_on(&repo, &dir, "file.txt", "feature side\n", "feature edit");
        switch(&repo, "master");

        let result = merge_branch(&repo, "feature").unwrap();
        assert!(!result.success);
        assert_eq!(result.conflicted_files, vec!["file.txt".to_string()]);
        assert_eq!(repo.state(), git2::RepositoryState::Merge);

        abort_merge(&repo).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert_eq!(fs::read_to_string(dir.path().join("file.txt")).unwrap(), "master side\n");
    }

    #[test]
    fn fast_forward_merge_moves_branch() {
        let (dir, repo) = base_repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();
        switch(&repo, "feature");
        commit_on(&repo, &dir, "feat.txt", "f", "on feature");
        let feature_tip = repo.head().unwrap().target().unwrap();
        switch(&repo, "master");

        merge_branch(&repo, "feature").unwrap();
        assert_eq!(repo.head().unwrap().target().unwrap(), feature_tip);
        assert!(dir.path().join("feat.txt").exists());
    }
}
