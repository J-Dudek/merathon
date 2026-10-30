use git2::{ErrorClass, ErrorCode};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("{}", describe_git(.0))]
    Git(#[from] git2::Error),
    #[error("Dépôt introuvable : {0}")]
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

/// Erreur libgit2 expliquée en français à partir de son code, suivie du message d'origine (sans les
/// suffixes techniques « class=… ; code=… ») ; un code sans explication garde le seul message d'origine.
fn describe_git(e: &git2::Error) -> String {
    let message = e.message().trim_end_matches('.');
    let hint = match e.code() {
        ErrorCode::Auth => Some("Authentification refusée par le dépôt distant : vérifie ta clé SSH, ton token ou ton gestionnaire d'identifiants"),
        ErrorCode::Certificate => Some("Certificat du serveur non reconnu : vérifie l'URL du dépôt distant ou la configuration du proxy"),
        ErrorCode::NotFastForward => Some("Le dépôt distant contient des commits absents en local : récupère-les (pull) avant de pousser"),
        ErrorCode::Conflict => Some("Des modifications locales seraient écrasées : commite-les ou mets-les de côté (stash) avant"),
        ErrorCode::IndexDirty | ErrorCode::Uncommitted => Some("Des modifications non commitées empêchent l'opération : commite-les ou mets-les de côté (stash)"),
        ErrorCode::MergeConflict | ErrorCode::Unmerged => Some("Des conflits ne sont pas résolus : résous-les avant de continuer"),
        ErrorCode::Locked => Some("Le dépôt est verrouillé par une autre opération git (fichier .lock) : réessaie une fois celle-ci terminée"),
        ErrorCode::UnbornBranch => Some("La branche courante n'a encore aucun commit"),
        ErrorCode::Exists => Some("Cet élément existe déjà"),
        ErrorCode::Ambiguous => Some("Référence ambiguë : plusieurs objets correspondent"),
        ErrorCode::InvalidSpec => Some("Nom invalide pour git"),
        ErrorCode::BareRepo => Some("Opération impossible sur un dépôt sans copie de travail (bare)"),
        ErrorCode::Modified => Some("La référence a changé entre-temps : actualise puis réessaie"),
        ErrorCode::Timeout => Some("Le dépôt distant ne répond pas (délai dépassé) : vérifie ta connexion"),
        ErrorCode::Owner => Some("Le dépôt appartient à un autre utilisateur"),
        _ => match e.class() {
            ErrorClass::Net | ErrorClass::Http => Some("Impossible de joindre le dépôt distant : vérifie ta connexion et l'URL du remote"),
            ErrorClass::Ssh => Some("Échec de la connexion SSH : vérifie ta clé et l'accès au serveur"),
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
        assert_eq!(GitError::Conflict("Résous tous les conflits".into()).to_string(), "Résous tous les conflits");
    }
}
