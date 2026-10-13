use git2::{Repository, RepositoryState};
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
    Repository::open(path).map_err(|_| GitError::NotFound(path.to_string()))
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
            "Identité Git non configurée : renseigne ton nom et ton email dans l'onglet Comptes".into(),
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
