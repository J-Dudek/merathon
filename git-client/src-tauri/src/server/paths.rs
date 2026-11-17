//! Confinement des chemins reçus de l'interface aux dossiers autorisés (`MERATHON_ALLOWED_ROOTS`).
//!
//! Le service donne accès à des dépôts du NAS : sans ce contrôle, n'importe quel dossier lisible par son utilisateur
//! pourrait être ouvert, cloné ou utilisé comme dossier de travail du terminal.

use std::path::{Component, Path, PathBuf};

/// Arguments des commandes qui désignent un dossier du disque (les autres chemins sont relatifs à un dépôt, et
/// validés par `git::paths`).
pub const PATH_ARGUMENTS: [&str; 3] = ["path", "dir", "cwd"];

/// Commandes dont un argument porte l'un de ces noms **sans** désigner un dossier : le `path` de `forge_api` est une adresse
/// de l'API GitHub / GitLab (`/user/repos?per_page=100`). Un `path` nouveau qui ne serait pas un dossier doit être ajouté ici :
/// sans cela il serait refusé (« Dossier hors des dossiers autorisés »), ce qui se voit tout de suite ; l'inverse, lui, ne se
/// verrait pas, d'où la liste explicite plutôt qu'une détection.
pub const NOT_FOLDER_ARGUMENTS: [&str; 2] = ["forge_api", "forge_api_send"];

/// Chemin réel de `path`, ou de son plus proche ancêtre existant suivi du reste (pour un dossier à créer).
fn resolve(path: &Path) -> Result<PathBuf, String> {
    let mut missing = Vec::new();
    let mut current = path;
    loop {
        match current.canonicalize() {
            Ok(real) => return Ok(missing.iter().rev().fold(real, |acc, part: &&std::ffi::OsStr| acc.join(part))),
            Err(_) => {
                let (Some(parent), Some(name)) = (current.parent(), current.file_name()) else {
                    return Err(tr!("Chemin introuvable : {}", "Path not found: {}", path.display()));
                };
                missing.push(name);
                current = parent;
            }
        }
    }
}

/// `path` est-il dans l'un des dossiers autorisés ? Sans dossier configuré, rien n'est restreint (développement).
pub fn check(path: &str, roots: &[PathBuf]) -> Result<(), String> {
    if roots.is_empty() {
        return Ok(());
    }
    let denied = || tr!("Dossier hors des dossiers autorisés : {path}", "Folder outside the allowed folders: {path}");
    let candidate = Path::new(path);
    if path.contains('\0') || !candidate.is_absolute() || candidate.components().any(|c| c == Component::ParentDir) {
        return Err(denied());
    }
    let real = resolve(candidate)?;
    let allowed = roots.iter().filter_map(|root| root.canonicalize().ok()).any(|root| real.starts_with(root));
    if allowed { Ok(()) } else { Err(denied()) }
}

/// Dossier autorisé qui contient `dir` (le premier, sans `dir`) : le sélecteur de dossiers y reste confiné.
pub fn root_for(roots: &[PathBuf], dir: Option<&str>) -> Option<PathBuf> {
    let containing = dir.and_then(|dir| {
        let real = resolve(Path::new(dir)).ok()?;
        roots.iter().find(|root| root.canonicalize().is_ok_and(|root| real.starts_with(root)))
    });
    containing.or_else(|| roots.first()).cloned()
}

/// Premier dossier d'`args` (ceux de la commande `command`) désignant un chemin hors des dossiers autorisés.
pub fn check_arguments(command: &str, args: &serde_json::Map<String, serde_json::Value>, roots: &[PathBuf]) -> Result<(), String> {
    if NOT_FOLDER_ARGUMENTS.contains(&command) {
        return Ok(());
    }
    for key in PATH_ARGUMENTS {
        if let Some(serde_json::Value::String(path)) = args.get(key) {
            check(path, roots)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn unrestricted_without_roots() {
        assert!(check("/etc", &[]).is_ok());
    }

    #[test]
    fn only_paths_under_a_root_are_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("git");
        fs::create_dir_all(root.join("a/b")).unwrap();
        let roots = vec![root.clone()];
        assert!(check(root.to_str().unwrap(), &roots).is_ok());
        assert!(check(root.join("a/b").to_str().unwrap(), &roots).is_ok());
        // Dossier à créer (clone, init) : son plus proche ancêtre existant compte.
        assert!(check(root.join("a/nouveau/depot").to_str().unwrap(), &roots).is_ok());
        assert!(check(dir.path().to_str().unwrap(), &roots).is_err());
        assert!(check("/etc", &roots).is_err());
    }

    #[test]
    fn dot_dot_relative_and_nul_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let roots = vec![dir.path().to_path_buf()];
        assert!(check(&format!("{}/../..", dir.path().display()), &roots).is_err());
        assert!(check("depot", &roots).is_err());
        assert!(check(&format!("{}/x\0y", dir.path().display()), &roots).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_cannot_leave_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("git");
        let outside = dir.path().join("secret");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("lien")).unwrap();
        let roots = vec![root.clone()];
        assert!(check(root.join("lien").to_str().unwrap(), &roots).is_err());
        assert!(check(root.join("lien/sous").to_str().unwrap(), &roots).is_err());
    }

    #[test]
    fn the_picker_root_is_the_one_containing_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        fs::create_dir_all(b.join("depots")).unwrap();
        fs::create_dir_all(&a).unwrap();
        let roots = vec![a.clone(), b.clone()];
        assert_eq!(root_for(&roots, None), Some(a.clone()));
        assert_eq!(root_for(&roots, Some(b.join("depots").to_str().unwrap())), Some(b));
        assert_eq!(root_for(&roots, Some("/etc")), Some(a));
        assert_eq!(root_for(&[], None), None);
    }

    #[test]
    fn api_paths_are_not_folders() {
        let roots = vec![PathBuf::from("/volume1/git")];
        let api = serde_json::json!({ "accountId": "a", "path": "/user/repos?per_page=100&sort=updated" });
        // Un dossier : refusé. Une adresse d'API de forge : ce n'est pas un chemin du disque.
        assert!(check_arguments("open_repository", api.as_object().unwrap(), &roots).is_err());
        for command in NOT_FOLDER_ARGUMENTS {
            assert!(check_arguments(command, api.as_object().unwrap(), &roots).is_ok(), "{command}");
        }
    }

    /// Une exception qui ne désigne plus aucune commande (renommée, supprimée) est une exception oubliée : elle doit disparaître.
    #[test]
    fn exceptions_name_registered_commands() {
        let registered = crate::server::dispatch::names();
        for command in NOT_FOLDER_ARGUMENTS {
            assert!(registered.contains(&command), "{command} n'est plus une commande du serveur");
        }
    }

    #[test]
    fn path_arguments_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let roots = vec![dir.path().to_path_buf()];
        let inside = serde_json::json!({ "path": dir.path(), "name": "/etc" });
        assert!(check_arguments("open_repository", inside.as_object().unwrap(), &roots).is_ok());
        for key in PATH_ARGUMENTS {
            let outside = serde_json::json!({ key: "/etc" });
            assert!(check_arguments("open_repository", outside.as_object().unwrap(), &roots).is_err(), "{key}");
        }
        let null = serde_json::json!({ "path": null });
        assert!(check_arguments("open_repository", null.as_object().unwrap(), &roots).is_ok());
    }
}
