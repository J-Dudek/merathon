//! Validation des chemins de fichiers reçus de l'interface : ils doivent rester dans la copie
//! de travail du dépôt (défense en profondeur contre l'écriture ou la suppression hors du dépôt).

use std::path::{Component, Path, PathBuf};
use super::error::GitError;

fn invalid(rel: &str) -> GitError {
    GitError::Other(format!("Chemin refusé (hors du dépôt) : {rel}"))
}

/// Chemin relatif à la racine du dépôt, sans `..`, ni chemin absolu, ni accès à `.git`.
pub(crate) fn validate_rel(rel: &str) -> Result<(), GitError> {
    if rel.is_empty() || rel.contains('\0') {
        return Err(invalid(rel));
    }
    let mut first = true;
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(name) => {
                if first && name.to_string_lossy().eq_ignore_ascii_case(".git") {
                    return Err(invalid(rel));
                }
                first = false;
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return Err(invalid(rel)),
        }
    }
    if first {
        return Err(invalid(rel));
    }
    Ok(())
}

pub(crate) fn validate_all(paths: &[String]) -> Result<(), GitError> {
    paths.iter().try_for_each(|p| validate_rel(p))
}

/// Chemin absolu sûr pour lire / écrire / supprimer `rel` : vérifie aussi qu'aucun lien
/// symbolique intermédiaire ne mène hors du dépôt.
pub(crate) fn checked_path(workdir: &Path, rel: &str) -> Result<PathBuf, GitError> {
    validate_rel(rel)?;
    let root = workdir.canonicalize()?;
    let full = workdir.join(rel);
    // Le dossier parent (ou son plus proche ancêtre existant) doit être dans le dépôt.
    let mut ancestor = full.parent().map(Path::to_path_buf);
    while let Some(dir) = ancestor {
        if dir.exists() {
            if !dir.canonicalize()?.starts_with(&root) {
                return Err(invalid(rel));
            }
            break;
        }
        ancestor = dir.parent().map(Path::to_path_buf);
    }
    // Le fichier lui-même ne doit pas être un lien symbolique vers l'extérieur.
    if full.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink()) {
        let target = full.canonicalize().unwrap_or_default();
        if !target.starts_with(&root) {
            return Err(invalid(rel));
        }
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn accepts_regular_relative_paths() {
        for ok in ["a.txt", "src/main.rs", "./docs/x.md", "deep/.gitignore", "a/.git-keep"] {
            assert!(validate_rel(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_escapes_and_git_dir() {
        for bad in ["", "../x", "a/../../x", "/etc/passwd", ".git/config", ".GIT/hooks/pre-commit", ".", "a\0b"] {
            assert!(validate_rel(bad).is_err(), "{bad:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let repo = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), repo.path().join("link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("f"), repo.path().join("file-link")).unwrap();
        assert!(checked_path(repo.path(), "link/x.txt").is_err());
        assert!(checked_path(repo.path(), "file-link").is_err());
        assert!(checked_path(repo.path(), "inside/new.txt").is_ok());
    }
}
