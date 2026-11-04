use git2::{ErrorClass, ErrorCode};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("{}", describe_git(.0))]
    Git(#[from] git2::Error),
    #[error("{}", repository_not_found(.0))]
    NotFound(String),
    /// Dépôt appartenant à un autre utilisateur (ex. `\\wsl.localhost\…` vu depuis Windows) et
    /// absent de `safe.directory`. Le frontend reconnaît ce message à son préfixe.
    #[error("Untrusted repository (owned by another user): {0}")]
    Untrusted(String),
    /// Message déjà rédigé pour l'utilisateur.
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Other(String),
}

fn repository_not_found(path: &str) -> String {
    tr!("Dépôt introuvable : {path}", "Repository not found: {path}")
}

/// Erreur libgit2 expliquée en français à partir de son code, suivie du message d'origine (sans les
/// suffixes techniques « class=… ; code=… ») ; un code sans explication garde le seul message d'origine.
fn describe_git(e: &git2::Error) -> String {
    let message = e.message().trim_end_matches('.');
    if message.contains("HEAD of a linked repository") || message.ends_with("is already checked out") {
        return tr!("Cette branche est extraite dans un autre worktree ({message})", "This branch is checked out in another worktree ({message})");
    }
    let hint = match e.code() {
        ErrorCode::Auth => Some(tr!("Authentification refusée par le dépôt distant : vérifie ta clé SSH, ton token ou ton gestionnaire d'identifiants", "Authentication refused by the remote repository: check your SSH key, your token or your credential manager")),
        ErrorCode::Certificate => Some(tr!("Certificat du serveur non reconnu : vérifie l'URL du dépôt distant ou la configuration du proxy", "Server certificate not recognized: check the remote repository URL or the proxy configuration")),
        ErrorCode::NotFastForward => Some(tr!("Le dépôt distant contient des commits absents en local : récupère-les (pull) avant de pousser", "The remote repository contains commits missing locally: pull them before pushing")),
        ErrorCode::Conflict => Some(tr!("Des modifications locales seraient écrasées : commite-les ou mets-les de côté (stash) avant", "Local changes would be overwritten: commit or stash them first")),
        ErrorCode::IndexDirty | ErrorCode::Uncommitted => Some(tr!("Des modifications non commitées empêchent l'opération : commite-les ou mets-les de côté (stash)", "Uncommitted changes prevent the operation: commit or stash them")),
        ErrorCode::MergeConflict | ErrorCode::Unmerged => Some(tr!("Des conflits ne sont pas résolus : résous-les avant de continuer", "Some conflicts are unresolved: resolve them before continuing")),
        ErrorCode::Locked => Some(tr!("Le dépôt est verrouillé par une autre opération git (fichier .lock) : réessaie une fois celle-ci terminée", "The repository is locked by another git operation (.lock file): try again once it has finished")),
        ErrorCode::UnbornBranch => Some(tr!("La branche courante n'a encore aucun commit", "The current branch has no commits yet")),
        ErrorCode::Exists => Some(tr!("Cet élément existe déjà", "This item already exists")),
        ErrorCode::Ambiguous => Some(tr!("Référence ambiguë : plusieurs objets correspondent", "Ambiguous reference: several objects match")),
        ErrorCode::InvalidSpec => Some(tr!("Nom invalide pour git", "Invalid name for git")),
        ErrorCode::BareRepo => Some(tr!("Opération impossible sur un dépôt sans copie de travail (bare)", "Operation not possible on a repository without a working copy (bare)")),
        ErrorCode::Modified => Some(tr!("La référence a changé entre-temps : actualise puis réessaie", "The reference changed in the meantime: refresh then try again")),
        ErrorCode::Timeout => Some(tr!("Le dépôt distant ne répond pas (délai dépassé) : vérifie ta connexion", "The remote repository is not responding (timed out): check your connection")),
        ErrorCode::Owner => Some(tr!("Le dépôt appartient à un autre utilisateur", "The repository belongs to another user")),
        _ => match e.class() {
            ErrorClass::Net | ErrorClass::Http => Some(tr!("Impossible de joindre le dépôt distant : vérifie ta connexion et l'URL du remote", "Could not reach the remote repository: check your connection and the remote URL")),
            ErrorClass::Ssh => Some(tr!("Échec de la connexion SSH : vérifie ta clé et l'accès au serveur", "SSH connection failed: check your key and access to the server")),
            _ => None,
        },
    };
    match hint {
        Some(hint) if !message.is_empty() => format!("{hint} ({message})"),
        Some(hint) => hint.to_string(),
        None => message.to_string(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_known_codes_and_drops_technical_suffixes() {
        let auth = git2::Error::new(ErrorCode::Auth, ErrorClass::Http, "remote authentication required.");
        assert_eq!(
            GitError::from(auth).to_string(),
            "Authentification refusée par le dépôt distant : vérifie ta clé SSH, ton token ou ton gestionnaire d'identifiants \
             (remote authentication required)"
        );
        let network = git2::Error::new(ErrorCode::GenericError, ErrorClass::Net, "failed to resolve address for github.com");
        assert!(GitError::from(network).to_string().starts_with("Impossible de joindre le dépôt distant"));
    }

    #[test]
    fn keeps_the_plain_message_when_there_is_nothing_to_add() {
        let other = git2::Error::new(ErrorCode::NotFound, ErrorClass::Reference, "reference 'refs/heads/x' not found");
        assert_eq!(GitError::from(other).to_string(), "reference 'refs/heads/x' not found");
        let linked = git2::Error::new(ErrorCode::GenericError, ErrorClass::Reference, "Cannot delete branch 'refs/heads/x' as it is the current HEAD of a linked repository.");
        assert!(GitError::from(linked).to_string().starts_with("Cette branche est extraite dans un autre worktree"));
        assert_eq!(GitError::Conflict("Résous tous les conflits".into()).to_string(), "Résous tous les conflits");
    }
}
