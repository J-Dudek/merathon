use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("Repository not found at: {0}")]
    NotFound(String),
    /// Dépôt appartenant à un autre utilisateur (ex. `\\wsl.localhost\…` vu depuis Windows) et
    /// absent de `safe.directory`. Le frontend reconnaît ce message à son préfixe.
    #[error("Untrusted repository (owned by another user): {0}")]
    Untrusted(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        GitError::Other(e.to_string())
    }
}

impl serde::Serialize for GitError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
