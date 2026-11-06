//! Dossiers des dépôts sur mobile. Android n'a pas de sélecteur de dossier utilisable : celui de Tauri n'existe pas
//! sur mobile et celui du système renvoie des URI `content://`, que libgit2 ne sait pas lire. Les dépôts vont donc
//! dans le dossier privé de l'application, parcouru par le sélecteur de l'interface (FolderPicker.tsx).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::git::GitError;

#[derive(Debug, PartialEq, Serialize)]
pub struct DeviceFolder {
    pub name: String,
    pub path: String,
    pub is_repo: bool,
}

fn io_error(e: std::io::Error) -> GitError {
    GitError::Other(e.to_string())
}

/// Crée la racine si besoin et renvoie son chemin réel, celui auquel les chemins parcourus sont comparés.
pub fn prepare_root(root: &Path) -> Result<PathBuf, GitError> {
    fs::create_dir_all(root).map_err(io_error)?;
    fs::canonicalize(root).map_err(io_error)
}

/// Chemin réel de `dir`, refusé s'il sort de la racine (`..`, lien symbolique).
fn inside_root(root: &Path, dir: &str) -> Result<PathBuf, GitError> {
    let root = fs::canonicalize(root).map_err(io_error)?;
    let dir = fs::canonicalize(dir).map_err(io_error)?;
    if dir.starts_with(&root) {
        Ok(dir)
    } else {
        Err(GitError::Other(tr!("Dossier hors de l'espace de l'application", "Folder outside the app's storage")))
    }
}

/// Sous-dossiers visibles de `dir`, triés sans tenir compte de la casse.
pub fn list_folders(root: &Path, dir: &str) -> Result<Vec<DeviceFolder>, GitError> {
    let dir = inside_root(root, dir)?;
    let mut folders = Vec::new();
    for entry in fs::read_dir(dir).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !entry.file_type().map_err(io_error)?.is_dir() {
            continue;
        }
        let path = entry.path();
        folders.push(DeviceFolder {
            name,
            is_repo: path.join(".git").exists(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    folders.sort_by_key(|f| f.name.to_lowercase());
    Ok(folders)
}

/// Crée le sous-dossier `name` de `dir` et renvoie son chemin.
pub fn create_folder(root: &Path, dir: &str, name: &str) -> Result<String, GitError> {
    let dir = inside_root(root, dir)?;
    let name = name.trim();
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\', '\0']) {
        return Err(GitError::Other(tr!("Nom de dossier invalide", "Invalid folder name")));
    }
    let path = dir.join(name);
    fs::create_dir(&path).map_err(io_error)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Android : une application n'a pas de variable HOME, dont dépendent `.gitconfig`, `.ssh` et les profils Git. Elle
/// pointe vers le dossier privé de l'application, avant le premier appel à libgit2 qui la lit une fois pour toutes.
#[cfg(target_os = "android")]
pub fn set_home(app: &tauri::App) {
    use tauri::Manager;
    match app.path().app_data_dir() {
        // Appelé au démarrage, avant les premières commandes.
        Ok(dir) => std::env::set_var("HOME", dir),
        Err(e) => eprintln!("dossier de l'application introuvable : {e}"),
    }
}

/// Blocs PEM des certificats d'un dossier, sans le texte descriptif que contiennent les fichiers d'Android.
#[cfg(any(target_os = "android", test))]
fn certificate_blocks(dir: &Path) -> std::io::Result<Vec<String>> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let mut paths: Vec<_> = fs::read_dir(dir)?.map(|e| e.map(|e| e.path())).collect::<Result<_, _>>()?;
    paths.sort();
    let mut blocks = Vec::new();
    for path in paths {
        let text = fs::read_to_string(path)?;
        let mut rest = text.as_str();
        while let Some((start, end)) = rest.find(BEGIN).and_then(|start| Some((start, start + rest[start..].find(END)? + END.len()))) {
            blocks.push(rest[start..end].to_string());
            rest = &rest[end..];
        }
    }
    Ok(blocks)
}

/// Android : donne à libgit2 les autorités de certification du système. Sans cela, tout échange HTTPS de Git (clone,
/// fetch, push) échoue : « the SSL certificate is invalid ». Elles passent par la mémoire : l'OpenSSL d'Android est
/// compilé sans accès aux fichiers (`no-stdio`, voir openssl-src), et `git2::opts::set_ssl_cert_file` y échoue donc.
#[cfg(target_os = "android")]
pub fn trust_system_certificates() -> Result<usize, GitError> {
    // Depuis Android 14, le dossier à jour est celui du module Conscrypt.
    const STORES: [&str; 2] = ["/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"];
    let blocks = STORES
        .iter()
        .find_map(|dir| certificate_blocks(Path::new(dir)).ok().filter(|b| !b.is_empty()))
        .ok_or_else(|| GitError::Other("no system certificate store".into()))?;
    libgit2_sys::init();
    let mut added = 0;
    for block in &blocks {
        // SAFETY : le tampon vit jusqu'à la libération du BIO, et le magasin de libgit2 garde sa propre référence au
        // certificat. Un certificat illisible est ignoré : les autres restent utilisables.
        unsafe {
            let bio = openssl_sys::BIO_new_mem_buf(block.as_ptr().cast(), block.len() as std::ffi::c_int);
            if bio.is_null() {
                continue;
            }
            let cert = openssl_sys::PEM_read_bio_X509(bio, std::ptr::null_mut(), None, std::ptr::null_mut());
            if !cert.is_null() {
                let option = libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as std::ffi::c_int;
                if libgit2_sys::git_libgit2_opts(option, cert) == 0 {
                    added += 1;
                }
                openssl_sys::X509_free(cert);
            }
            openssl_sys::BIO_free_all(bio);
        }
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_certificate_blocks() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("b.0"), "-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----\nCertificate:\n  Data: x\n").unwrap();
        fs::write(dir.path().join("a.0"), "intro\n-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n").unwrap();
        assert_eq!(
            certificate_blocks(dir.path()).unwrap(),
            ["-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----", "-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----"],
        );
    }

    fn setup() -> (tempfile::TempDir, PathBuf) {
        let base = tempfile::tempdir().unwrap();
        let root = prepare_root(&base.path().join("repos")).unwrap();
        (base, root)
    }

    #[test]
    fn lists_visible_folders_sorted_and_flags_repositories() {
        let (_base, root) = setup();
        fs::create_dir_all(root.join("zeta/.git")).unwrap();
        fs::create_dir(root.join("Alpha")).unwrap();
        fs::create_dir(root.join(".hidden")).unwrap();
        fs::write(root.join("file.txt"), "x").unwrap();

        let folders = list_folders(&root, root.to_str().unwrap()).unwrap();
        let summary: Vec<_> = folders.iter().map(|f| (f.name.as_str(), f.is_repo)).collect();
        assert_eq!(summary, [("Alpha", false), ("zeta", true)]);
    }

    #[test]
    fn refuses_folders_outside_the_root() {
        let (base, root) = setup();
        let parent = format!("{}/..", root.display());
        assert!(list_folders(&root, &parent).is_err());
        assert!(list_folders(&root, base.path().to_str().unwrap()).is_err());
        assert!(create_folder(&root, &parent, "evil").is_err());
        assert!(!base.path().join("evil").exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_leaving_the_root() {
        let (base, root) = setup();
        std::os::unix::fs::symlink(base.path(), root.join("out")).unwrap();
        assert!(list_folders(&root, root.join("out").to_str().unwrap()).is_err());
    }

    #[test]
    fn creates_a_folder_and_rejects_unsafe_names() {
        let (_base, root) = setup();
        let dir = root.to_str().unwrap();
        let created = create_folder(&root, dir, " projet ").unwrap();
        assert_eq!(PathBuf::from(created), root.join("projet"));
        for name in ["", "  ", "..", ".git", "a/b", "../b", "a\\b"] {
            assert!(create_folder(&root, dir, name).is_err(), "{name:?}");
        }
    }
}
