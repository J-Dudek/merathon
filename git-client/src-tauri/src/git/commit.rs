use git2::{Oid, Repository, RepositoryState};
use super::error::GitError;
use super::repository::signature;

/// Crée un commit à partir de l'index.
/// - `amend` : remplace le commit HEAD (message et contenu).
/// - en cours de merge, le commit reçoit MERGE_HEAD comme parent supplémentaire ;
///   en fin de merge / cherry-pick / revert, l'état du dépôt est nettoyé.
pub fn create_commit(repo: &Repository, message: &str, amend: bool) -> Result<String, GitError> {
    if message.trim().is_empty() {
        return Err(GitError::Other("Le message de commit est vide".into()));
    }
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(GitError::Conflict("Résous tous les conflits avant de commiter".into()));
    }

    let sig = signature(repo)?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head = repo.head().ok().and_then(|r| r.peel_to_commit().ok());

    let oid = if amend {
        let head = head.ok_or_else(|| GitError::Other("Aucun commit à modifier".into()))?;
        head.amend(Some("HEAD"), None, Some(&sig), None, Some(message), Some(&tree))?
    } else {
        let mut parents: Vec<git2::Commit> = head.into_iter().collect();
        if repo.state() == RepositoryState::Merge {
            for oid in merge_heads(repo)? {
                parents.push(repo.find_commit(oid)?);
            }
        }
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?
    };

    if matches!(
        repo.state(),
        RepositoryState::Merge
            | RepositoryState::CherryPick
            | RepositoryState::CherryPickSequence
            | RepositoryState::Revert
            | RepositoryState::RevertSequence
    ) {
        repo.cleanup_state()?;
    }

    Ok(oid.to_string())
}

/// Remplace le message du dernier commit sans toucher à son contenu : les fichiers indexés n'y sont pas ajoutés.
pub fn reword_head(repo: &Repository, message: &str) -> Result<String, GitError> {
    if message.trim().is_empty() {
        return Err(GitError::Other("Le message de commit est vide".into()));
    }
    if repo.state() != RepositoryState::Clean {
        return Err(GitError::Other("Termine d'abord l'opération en cours (merge, rebase…)".into()));
    }
    let head = repo.head()?.peel_to_commit()?;
    let sig = signature(repo)?;
    let oid = head.amend(Some("HEAD"), None, Some(&sig), None, Some(message), None)?;
    Ok(oid.to_string())
}

/// Lit .git/MERGE_HEAD (`mergehead_foreach` exige un dépôt mutable).
fn merge_heads(repo: &Repository) -> Result<Vec<Oid>, GitError> {
    let raw = std::fs::read_to_string(repo.path().join("MERGE_HEAD"))?;
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| Oid::from_str(l).map_err(GitError::from))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn repo_with_identity() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@test.com").unwrap();
        (dir, repo)
    }

    fn stage(repo: &Repository, file: &str) {
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
    }

    #[test]
    fn reword_keeps_the_tree_and_ignores_the_index() {
        let (dir, repo) = repo_with_identity();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        stage(&repo, "a.txt");
        create_commit(&repo, "first", false).unwrap();
        let before = repo.head().unwrap().peel_to_commit().unwrap();
        fs::write(dir.path().join("b.txt"), "b").unwrap();
        stage(&repo, "b.txt");

        reword_head(&repo, "renamed").unwrap();
        let after = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(after.message().ok(), Some("renamed"));
        assert_eq!(after.tree_id(), before.tree_id());
        assert_ne!(after.id(), before.id());
    }

    #[test]
    fn first_commit_has_no_parent() {
        let (dir, repo) = repo_with_identity();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        stage(&repo, "a.txt");
        create_commit(&repo, "first", false).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 0);
        assert_eq!(head.message().ok(), Some("first"));
    }

    #[test]
    fn amend_replaces_head() {
        let (dir, repo) = repo_with_identity();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        stage(&repo, "a.txt");
        create_commit(&repo, "first", false).unwrap();
        fs::write(dir.path().join("b.txt"), "b").unwrap();
        stage(&repo, "b.txt");
        create_commit(&repo, "first (amended)", true).unwrap();

        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 0);
        assert_eq!(head.message().ok(), Some("first (amended)"));
        assert!(head.tree().unwrap().get_name("b.txt").is_some());
    }

    #[test]
    fn empty_message_is_rejected() {
        let (_dir, repo) = repo_with_identity();
        assert!(create_commit(&repo, "  ", false).is_err());
    }
}
