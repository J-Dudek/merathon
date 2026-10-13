use git2::{build::CheckoutBuilder, BranchType, ErrorCode, Rebase, Repository, ResetType};
use serde::Serialize;
use super::error::GitError;
use super::merge::{conflicted_paths, resolve_annotated, MergeResult};
use super::repository::signature;

#[derive(Debug, Serialize)]
pub struct RebaseResult {
    pub conflicted_files: Vec<String>,
    pub success: bool,
}

fn checkout_ref(repo: &Repository, refname: &str) -> Result<(), GitError> {
    let target = repo.find_reference(refname)?.peel_to_commit()?;
    // On met à jour la copie de travail avant de déplacer HEAD : si le checkout échoue
    // (modifications locales en conflit), HEAD reste inchangé.
    repo.checkout_tree(target.as_object(), Some(CheckoutBuilder::default().safe()))?;
    repo.set_head(refname)?;
    Ok(())
}

pub fn checkout_branch(repo: &Repository, name: &str) -> Result<(), GitError> {
    let branch = repo.find_branch(name, BranchType::Local)?;
    let ref_name = branch
        .get()
        .name()
        .map_err(|_| GitError::NotFound("ref invalide".into()))?
        .to_string();
    checkout_ref(repo, &ref_name)
}

/// Checkout d'une branche distante (ex. `origin/feature`) : crée si besoin la branche
/// locale `feature` qui la suit, puis bascule dessus.
pub fn checkout_remote_branch(repo: &Repository, remote_branch: &str) -> Result<String, GitError> {
    let remote = repo.find_branch(remote_branch, BranchType::Remote)?;
    let local_name = remote_branch
        .split_once('/')
        .map(|(_, rest)| rest.to_string())
        .ok_or_else(|| GitError::Other(format!("nom de branche distante invalide : {remote_branch}")))?;

    if repo.find_branch(&local_name, BranchType::Local).is_err() {
        let commit = remote.get().peel_to_commit()?;
        let mut local = repo.branch(&local_name, &commit, false)?;
        local.set_upstream(Some(remote_branch))?;
    }
    checkout_branch(repo, &local_name)?;
    Ok(local_name)
}

pub fn checkout_commit(repo: &Repository, hash: &str) -> Result<(), GitError> {
    let commit = repo.revparse_single(hash)?.peel_to_commit()?;
    repo.checkout_tree(commit.as_object(), Some(CheckoutBuilder::default().safe()))?;
    repo.set_head_detached(commit.id())?;
    Ok(())
}

pub fn create_branch(repo: &Repository, name: &str, from_ref: &str) -> Result<(), GitError> {
    let obj = repo.revparse_single(from_ref)?;
    let commit = obj.peel_to_commit()?;
    repo.branch(name, &commit, false)?;
    Ok(())
}

pub fn delete_branch(repo: &Repository, name: &str) -> Result<(), GitError> {
    let mut branch = repo.find_branch(name, BranchType::Local)?;
    branch.delete()?;
    Ok(())
}

pub fn rename_branch(repo: &Repository, old: &str, new: &str) -> Result<(), GitError> {
    let mut branch = repo.find_branch(old, BranchType::Local)?;
    branch.rename(new, false)?;
    Ok(())
}

pub fn set_upstream(repo: &Repository, name: &str, upstream: Option<&str>) -> Result<(), GitError> {
    let mut branch = repo.find_branch(name, BranchType::Local)?;
    branch.set_upstream(upstream)?;
    Ok(())
}

/// Rebase la branche courante sur `onto` (branche locale, distante ou hash).
/// En cas de conflit, le rebase reste en cours : résoudre puis `continue_rebase`, ou `abort_rebase`.
pub fn rebase_onto(repo: &Repository, onto_name: &str) -> Result<RebaseResult, GitError> {
    let onto = resolve_annotated(repo, onto_name)?;
    let mut rebase = repo.rebase(None, None, Some(&onto), None)?;
    run_rebase(repo, &mut rebase)
}

pub fn continue_rebase(repo: &Repository) -> Result<RebaseResult, GitError> {
    let mut rebase = repo.open_rebase(None)?;
    if !conflicted_paths(repo)?.is_empty() {
        return Err(GitError::Conflict("Résous tous les conflits avant de continuer le rebase".into()));
    }
    if rebase.operation_current().is_some() {
        commit_rebase_step(repo, &mut rebase)?;
    }
    run_rebase(repo, &mut rebase)
}

pub fn abort_rebase(repo: &Repository) -> Result<(), GitError> {
    repo.open_rebase(None)?.abort()?;
    Ok(())
}

fn run_rebase(repo: &Repository, rebase: &mut Rebase) -> Result<RebaseResult, GitError> {
    while let Some(op) = rebase.next() {
        if let Err(e) = op {
            let _ = rebase.abort();
            return Err(e.into());
        }
        let conflicted = conflicted_paths(repo)?;
        if !conflicted.is_empty() {
            return Ok(RebaseResult { conflicted_files: conflicted, success: false });
        }
        commit_rebase_step(repo, rebase)?;
    }
    rebase.finish(Some(&signature(repo)?))?;
    Ok(RebaseResult { conflicted_files: vec![], success: true })
}

fn commit_rebase_step(repo: &Repository, rebase: &mut Rebase) -> Result<(), GitError> {
    match rebase.commit(None, &signature(repo)?, None) {
        Ok(_) => Ok(()),
        // Le patch est déjà présent dans la cible : le commit devient vide, on le saute.
        Err(e) if e.code() == ErrorCode::Applied => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn reset_to(repo: &Repository, hash: &str, mode: &str) -> Result<(), GitError> {
    let kind = match mode {
        "soft" => ResetType::Soft,
        "mixed" => ResetType::Mixed,
        "hard" => ResetType::Hard,
        other => return Err(GitError::Other(format!("mode de reset inconnu : {other}"))),
    };
    let target = repo.revparse_single(hash)?.peel_to_commit()?;
    repo.reset(target.as_object(), kind, None)?;
    Ok(())
}

pub fn cherry_pick(repo: &Repository, hash: &str) -> Result<MergeResult, GitError> {
    let commit = repo.revparse_single(hash)?.peel_to_commit()?;
    if commit.parent_count() > 1 {
        return Err(GitError::Other("Le cherry-pick d'un commit de merge n'est pas supporté".into()));
    }
    repo.cherrypick(&commit, None)?;

    let conflicted = conflicted_paths(repo)?;
    if !conflicted.is_empty() {
        return Ok(MergeResult { conflicted_files: conflicted, success: false });
    }

    let committer = signature(repo)?;
    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head = repo.head()?.peel_to_commit()?;
    repo.commit(
        Some("HEAD"),
        &commit.author(),
        &committer,
        commit.message().unwrap_or(""),
        &tree,
        &[&head],
    )?;
    repo.cleanup_state()?;
    Ok(MergeResult { conflicted_files: vec![], success: true })
}

pub fn revert_commit(repo: &Repository, hash: &str) -> Result<MergeResult, GitError> {
    let commit = repo.revparse_single(hash)?.peel_to_commit()?;
    if commit.parent_count() > 1 {
        return Err(GitError::Other("Le revert d'un commit de merge n'est pas supporté".into()));
    }
    repo.revert(&commit, None)?;

    let conflicted = conflicted_paths(repo)?;
    if !conflicted.is_empty() {
        return Ok(MergeResult { conflicted_files: conflicted, success: false });
    }

    let sig = signature(repo)?;
    let message = format!(
        "Revert \"{}\"\n\nThis reverts commit {}.",
        commit.summary().ok().flatten().unwrap_or(""),
        commit.id()
    );
    let mut index = repo.index()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head = repo.head()?.peel_to_commit()?;
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&head])?;
    repo.cleanup_state()?;
    Ok(MergeResult { conflicted_files: vec![], success: true })
}

/// Tag annoté si un message est fourni, léger sinon.
pub fn create_tag(repo: &Repository, name: &str, target: &str, message: Option<&str>) -> Result<(), GitError> {
    let obj = repo.revparse_single(target)?.peel_to_commit()?.into_object();
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(msg) => {
            repo.tag(name, &obj, &signature(repo)?, msg, false)?;
        }
        None => {
            repo.tag_lightweight(name, &obj, false)?;
        }
    }
    Ok(())
}

pub fn delete_tag(repo: &Repository, name: &str) -> Result<(), GitError> {
    repo.tag_delete(name)?;
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

        fs::write(dir.path().join("file.txt"), "v1\n").unwrap();
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

    fn add_commit(repo: &Repository, dir: &TempDir, filename: &str, content: &str, message: &str) {
        fs::write(dir.path().join(filename), content).unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(filename)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent]).unwrap();
    }

    #[test]
    fn checkout_switches_head() {
        let (_dir, repo) = base_repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();

        checkout_branch(&repo, "feature").unwrap();

        let current = repo.head().unwrap();
        assert_eq!(current.shorthand().unwrap(), "feature");
    }

    #[test]
    fn checkout_nonexistent_branch_returns_error() {
        let (_dir, repo) = base_repo();
        assert!(checkout_branch(&repo, "does-not-exist").is_err());
    }

    #[test]
    fn create_branch_from_head() {
        let (_dir, repo) = base_repo();
        create_branch(&repo, "new-branch", "HEAD").unwrap();
        assert!(repo.find_branch("new-branch", BranchType::Local).is_ok());
    }

    #[test]
    fn create_branch_from_commit_hash() {
        let (_dir, repo) = base_repo();
        let hash = repo.head().unwrap().target().unwrap().to_string();
        create_branch(&repo, "from-hash", &hash).unwrap();
        assert!(repo.find_branch("from-hash", BranchType::Local).is_ok());
    }

    #[test]
    fn create_branch_duplicate_returns_error() {
        let (_dir, repo) = base_repo();
        create_branch(&repo, "dup", "HEAD").unwrap();
        assert!(create_branch(&repo, "dup", "HEAD").is_err());
    }

    #[test]
    fn delete_branch_removes_it() {
        let (_dir, repo) = base_repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("to-delete", &head, false).unwrap();

        delete_branch(&repo, "to-delete").unwrap();

        assert!(repo.find_branch("to-delete", BranchType::Local).is_err());
    }

    #[test]
    fn delete_nonexistent_branch_returns_error() {
        let (_dir, repo) = base_repo();
        assert!(delete_branch(&repo, "ghost").is_err());
    }

    #[test]
    fn rebase_onto_linear_history() {
        let (dir, repo) = base_repo();

        // main: A -- B
        // feature branché sur A, on veut rebase feature sur B (main)
        let head_a = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head_a, false).unwrap();

        // Ajoute un commit sur main
        add_commit(&repo, &dir, "main.txt", "main work\n", "commit on main");

        // Checkout feature
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();

        // Ajoute un commit sur feature
        add_commit(&repo, &dir, "feat.txt", "feature work\n", "commit on feature");

        // Rebase feature onto main
        rebase_onto(&repo, "master").unwrap();

        // La branche feature doit avoir main comme ancêtre direct
        let feature_commit = repo.head().unwrap().peel_to_commit().unwrap();
        let parent = feature_commit.parent(0).unwrap();
        let main_commit = repo.find_branch("master", BranchType::Local).unwrap()
            .get().peel_to_commit().unwrap();
        assert_eq!(parent.id(), main_commit.id());
    }

    fn switch(repo: &Repository, branch: &str) {
        repo.set_head(&format!("refs/heads/{branch}")).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
    }

    #[test]
    fn checkout_with_conflicting_changes_keeps_head() {
        let (dir, repo) = base_repo();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &head, false).unwrap();
        switch(&repo, "feature");
        add_commit(&repo, &dir, "file.txt", "v2\n", "feature edit");
        switch(&repo, "master");
        fs::write(dir.path().join("file.txt"), "local edit\n").unwrap();

        assert!(checkout_branch(&repo, "feature").is_err());
        assert_eq!(repo.head().unwrap().shorthand().ok(), Some("master"));
        assert_eq!(fs::read_to_string(dir.path().join("file.txt")).unwrap(), "local edit\n");
    }

    #[test]
    fn checkout_remote_branch_creates_tracking_branch() {
        let (_dir, repo) = base_repo();
        repo.remote("origin", "https://example.com/repo.git").unwrap();
        let head = repo.head().unwrap().target().unwrap();
        repo.reference("refs/remotes/origin/feature", head, false, "test").unwrap();

        let local = checkout_remote_branch(&repo, "origin/feature").unwrap();
        assert_eq!(local, "feature");
        let branch = repo.find_branch("feature", BranchType::Local).unwrap();
        assert!(branch.is_head());
        assert_eq!(branch.upstream().unwrap().name().unwrap(), Some("origin/feature"));
    }

    #[test]
    fn checkout_commit_detaches_head() {
        let (dir, repo) = base_repo();
        let first = repo.head().unwrap().target().unwrap();
        add_commit(&repo, &dir, "b.txt", "b", "second");
        checkout_commit(&repo, &first.to_string()).unwrap();
        assert!(repo.head_detached().unwrap());
        assert!(!dir.path().join("b.txt").exists());
    }

    #[test]
    fn rename_branch_works() {
        let (_dir, repo) = base_repo();
        create_branch(&repo, "old", "HEAD").unwrap();
        rename_branch(&repo, "old", "new").unwrap();
        assert!(repo.find_branch("new", BranchType::Local).is_ok());
        assert!(repo.find_branch("old", BranchType::Local).is_err());
    }

    #[test]
    fn rebase_conflict_then_continue() {
        let (dir, repo) = base_repo();
        let base = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base, false).unwrap();
        add_commit(&repo, &dir, "file.txt", "master\n", "master edit");
        switch(&repo, "feature");
        add_commit(&repo, &dir, "file.txt", "feature\n", "feature edit");

        let result = rebase_onto(&repo, "master").unwrap();
        assert!(!result.success);
        assert_eq!(result.conflicted_files, vec!["file.txt".to_string()]);
        assert!(continue_rebase(&repo).is_err(), "continue must refuse while conflicts remain");

        fs::write(dir.path().join("file.txt"), "resolved\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("file.txt")).unwrap();
        index.write().unwrap();

        let result = continue_rebase(&repo).unwrap();
        assert!(result.success);
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(tip.message().ok(), Some("feature edit"));
        assert_eq!(tip.parent(0).unwrap().message().ok(), Some("master edit"));
    }

    #[test]
    fn rebase_conflict_then_abort() {
        let (dir, repo) = base_repo();
        let base = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base, false).unwrap();
        add_commit(&repo, &dir, "file.txt", "master\n", "master edit");
        switch(&repo, "feature");
        add_commit(&repo, &dir, "file.txt", "feature\n", "feature edit");
        let before = repo.head().unwrap().target().unwrap();

        rebase_onto(&repo, "master").unwrap();
        abort_rebase(&repo).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert_eq!(repo.head().unwrap().target().unwrap(), before);
    }

    #[test]
    fn reset_soft_keeps_changes_staged() {
        let (dir, repo) = base_repo();
        let first = repo.head().unwrap().target().unwrap();
        add_commit(&repo, &dir, "b.txt", "b", "second");
        reset_to(&repo, &first.to_string(), "soft").unwrap();
        assert_eq!(repo.head().unwrap().target().unwrap(), first);
        assert!(repo.status_file(std::path::Path::new("b.txt")).unwrap().contains(git2::Status::INDEX_NEW));
    }

    #[test]
    fn reset_hard_discards_changes() {
        let (dir, repo) = base_repo();
        let first = repo.head().unwrap().target().unwrap();
        add_commit(&repo, &dir, "b.txt", "b", "second");
        reset_to(&repo, &first.to_string(), "hard").unwrap();
        assert!(!dir.path().join("b.txt").exists());
    }

    #[test]
    fn cherry_pick_copies_commit() {
        let (dir, repo) = base_repo();
        let base = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base, false).unwrap();
        switch(&repo, "feature");
        add_commit(&repo, &dir, "feat.txt", "f", "feature work");
        let picked = repo.head().unwrap().target().unwrap();
        switch(&repo, "master");
        add_commit(&repo, &dir, "main.txt", "m", "master work");

        let result = cherry_pick(&repo, &picked.to_string()).unwrap();
        assert!(result.success);
        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(tip.message().ok(), Some("feature work"));
        assert_ne!(tip.id(), picked);
        assert!(dir.path().join("feat.txt").exists());
    }

    #[test]
    fn revert_undoes_commit() {
        let (dir, repo) = base_repo();
        add_commit(&repo, &dir, "b.txt", "b", "add b");
        let target = repo.head().unwrap().target().unwrap();

        let result = revert_commit(&repo, &target.to_string()).unwrap();
        assert!(result.success);
        assert!(!dir.path().join("b.txt").exists());
        let tip = repo.head().unwrap().peel_to_commit().unwrap();
        assert!(tip.message().unwrap().starts_with("Revert \"add b\""));
    }

    #[test]
    fn create_and_delete_tags() {
        let (_dir, repo) = base_repo();
        create_tag(&repo, "light", "HEAD", None).unwrap();
        create_tag(&repo, "annotated", "HEAD", Some("v1")).unwrap();
        assert!(repo.find_reference("refs/tags/light").is_ok());
        assert!(repo.find_reference("refs/tags/annotated").unwrap().peel_to_tag().is_ok());
        delete_tag(&repo, "light").unwrap();
        assert!(repo.find_reference("refs/tags/light").is_err());
    }
}
