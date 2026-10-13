//! Git LFS.
//!
//! libgit2 n'exécute pas le filtre `lfs` : sans précaution, indexer un fichier LFS commiterait
//! le binaire complet, et un push n'enverrait pas les objets LFS au serveur. Pour ces
//! opérations on délègue donc à `git` / `git lfs`, en leur fournissant les identifiants du
//! compte correspondant via un credential helper temporaire (token passé par variable
//! d'environnement, jamais sur la ligne de commande).

use std::path::{Path, PathBuf};
use std::process::Command;
use git2::{AttrCheckFlags, Repository};
use serde::Serialize;
use super::auth::Credentials;
use super::error::GitError;

#[derive(Debug, Serialize, Clone)]
pub struct LfsFile {
    pub path: String,
    /// Contenu présent localement (et pas seulement le pointeur).
    pub downloaded: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct LfsStatus {
    /// Le dépôt déclare des motifs `filter=lfs` dans .gitattributes.
    pub uses_lfs: bool,
    /// Version de git-lfs si installé (non vérifiée pour un dépôt sans LFS).
    pub version: Option<String>,
    pub patterns: Vec<String>,
    pub files: Vec<LfsFile>,
}

const NOT_INSTALLED: &str =
    "Ce dépôt utilise Git LFS mais git-lfs n'est pas installé (https://git-lfs.com) : installe-le puis réessaie";

fn workdir(repo: &Repository) -> Result<PathBuf, GitError> {
    repo.workdir()
        .map(Path::to_path_buf)
        .ok_or_else(|| GitError::Other("dépôt bare".into()))
}

/// Helper d'identification transmis à `git` : ne répond que pour l'hôte du compte, en HTTPS
/// (un `.lfsconfig` pointant vers un autre serveur n'obtient rien). Le token passe par
/// l'environnement du processus, jamais par la ligne de commande.
const CREDENTIAL_HELPER: &str = r#"!f() { test "$1" = get || exit 0; h=; p=; while IFS= read -r l; do [ -z "$l" ] && break; case "$l" in host=*) h="${l#host=}";; protocol=*) p="${l#protocol=}";; esac; done; h=$(printf %s "${h%%:*}" | tr A-Z a-z); [ "$h" = "$GIT_CLIENT_HOST" ] || exit 0; [ "$p" = https ] || [ "$GIT_CLIENT_ALLOW_HTTP" = 1 ] || exit 0; echo "username=$GIT_CLIENT_USERNAME"; echo "password=$GIT_CLIENT_TOKEN"; }; f"#;

/// Credential helpers de la configuration globale / système (jamais ceux du dépôt, dont la
/// configuration locale pourrait lancer une commande arbitraire).
fn trusted_credential_helpers() -> Vec<String> {
    let Ok(config) = git2::Config::open_default() else { return Vec::new() };
    let mut helpers = Vec::new();
    if let Ok(mut entries) = config.multivar("credential.helper", None) {
        while let Some(Ok(entry)) = entries.next() {
            match entry.value() {
                // Une valeur vide réinitialise la liste, comme le fait git.
                Ok("") => helpers.clear(),
                Ok(v) => helpers.push(v.to_string()),
                Err(_) => {}
            }
        }
    }
    helpers
}

fn trusted_ssh_command() -> String {
    git2::Config::open_default()
        .and_then(|c| c.get_string("core.sshCommand"))
        .unwrap_or_else(|_| "ssh".into())
}

/// Commande `git` durcie : la configuration locale d'un dépôt (éventuellement malveillant) ne
/// peut pas faire exécuter de commande. Les réglages qui lancent des programmes sont imposés.
fn git(dir: &Path, creds: Option<&Credentials>) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS");

    // Dossier inexistant : aucun hook du dépôt n'est exécuté.
    let no_hooks = dir.join(".git").join("gitclient-no-hooks");
    let overrides = [
        ("core.hooksPath", no_hooks.to_string_lossy().to_string()),
        ("core.fsmonitor", "false".into()),
        ("core.askPass", String::new()),
        ("core.sshCommand", trusted_ssh_command()),
        ("protocol.ext.allow", "never".into()),
        // Filtre LFS imposé : la config locale ne peut pas le remplacer par une autre commande.
        ("filter.lfs.clean", "git-lfs clean -- %f".into()),
        ("filter.lfs.smudge", "git-lfs smudge -- %f".into()),
        ("filter.lfs.process", "git-lfs filter-process".into()),
        ("filter.lfs.required", "true".into()),
    ];
    for (key, value) in overrides {
        cmd.arg("-c").arg(format!("{key}={value}"));
    }

    // Helpers d'identification : on vide la liste (y compris ceux du dépôt), puis le nôtre en
    // premier, puis ceux de la configuration globale de l'utilisateur.
    cmd.args(["-c", "credential.helper="]);
    if let Some(c) = creds {
        cmd.arg("-c")
            .arg(format!("credential.helper={CREDENTIAL_HELPER}"))
            .env("GIT_CLIENT_USERNAME", &c.username)
            .env("GIT_CLIENT_TOKEN", &c.token)
            .env("GIT_CLIENT_HOST", c.host.to_ascii_lowercase())
            .env("GIT_CLIENT_ALLOW_HTTP", if c.allow_http { "1" } else { "0" });
    }
    for helper in trusted_credential_helpers() {
        cmd.arg("-c").arg(format!("credential.helper={helper}"));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Argument passé à git qui ne doit pas pouvoir être pris pour une option.
fn safe_arg(value: &str) -> Result<&str, GitError> {
    if value.is_empty() || value.starts_with('-') || value.contains(['\0', '\n', '\r']) {
        return Err(GitError::Other(format!("Valeur refusée : {value:?}")));
    }
    Ok(value)
}

fn run(mut cmd: Command) -> Result<String, GitError> {
    let output = cmd
        .output()
        .map_err(|e| GitError::Other(format!("Impossible de lancer git : {e}")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(GitError::Other(if stderr.is_empty() { "commande git échouée".into() } else { stderr }))
    }
}

pub fn lfs_version() -> Option<String> {
    let mut cmd = git(Path::new("."), None);
    cmd.args(["lfs", "version"]);
    run(cmd).ok().map(|v| v.trim().to_string())
}

/// Motifs déclarés avec `filter=lfs` dans le .gitattributes racine.
pub fn tracked_patterns(repo: &Repository) -> Vec<String> {
    let Ok(dir) = workdir(repo) else { return Vec::new() };
    let Ok(content) = std::fs::read_to_string(dir.join(".gitattributes")) else { return Vec::new() };
    parse_lfs_patterns(&content)
}

fn parse_lfs_patterns(gitattributes: &str) -> Vec<String> {
    gitattributes
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let pattern = parts.next()?;
            parts.any(|a| a == "filter=lfs").then(|| pattern.to_string())
        })
        .collect()
}

pub fn uses_lfs(repo: &Repository) -> bool {
    !tracked_patterns(repo).is_empty()
}

/// Le fichier est-il géré par LFS (d'après tous les .gitattributes applicables) ?
pub fn is_lfs_path(repo: &Repository, path: &str) -> bool {
    repo.get_attr(Path::new(path), "filter", AttrCheckFlags::FILE_THEN_INDEX)
        .ok()
        .flatten()
        == Some("lfs")
}

fn ensure_installed() -> Result<(), GitError> {
    lfs_version().map(|_| ()).ok_or_else(|| GitError::Other(NOT_INSTALLED.into()))
}


/// Met à jour le cache stat de l'index après une écriture par git-lfs, pour que libgit2
/// ne voie pas les fichiers LFS comme modifiés (il ne sait pas appliquer le filtre).
fn refresh_index(dir: &Path) {
    let mut cmd = git(dir, None);
    cmd.args(["update-index", "-q", "--refresh"]);
    let _ = run(cmd);
}

pub fn lfs_status(repo: &Repository) -> Result<LfsStatus, GitError> {
    let patterns = tracked_patterns(repo);
    // Appelé à chaque rafraîchissement : on ne lance git-lfs que si le dépôt l'utilise.
    let version = if patterns.is_empty() { None } else { lfs_version() };
    let mut files = Vec::new();
    if !patterns.is_empty() && version.is_some() {
        let mut cmd = git(&workdir(repo)?, None);
        cmd.args(["lfs", "ls-files"]);
        // Format : "<oid> <* | -> <chemin>" ; '*' = contenu présent, '-' = pointeur seul.
        for line in run(cmd)?.lines() {
            let mut parts = line.splitn(3, ' ');
            let (_, marker, path) = (parts.next(), parts.next(), parts.next());
            if let (Some(marker), Some(path)) = (marker, path) {
                files.push(LfsFile { path: path.to_string(), downloaded: marker == "*" });
            }
        }
    }
    Ok(LfsStatus { uses_lfs: !patterns.is_empty(), version, patterns, files })
}

/// Indexe via `git add`, qui applique le filtre LFS (stocke un pointeur, pas le binaire).
pub fn git_add(repo: &Repository, paths: &[String]) -> Result<(), GitError> {
    ensure_installed()?;
    let dir = workdir(repo)?;
    let mut cmd = git(&dir, None);
    cmd.args(["add", "-A", "--"]).args(paths);
    run(cmd)?;
    Ok(())
}

/// Restaure via `git checkout`, qui réécrit le vrai contenu LFS (et pas le pointeur).
pub fn git_checkout_paths(repo: &Repository, paths: &[String]) -> Result<(), GitError> {
    ensure_installed()?;
    let dir = workdir(repo)?;
    let mut cmd = git(&dir, None);
    cmd.args(["checkout", "--"]).args(paths);
    run(cmd)?;
    Ok(())
}

/// Remplace les pointeurs par le contenu déjà présent localement (sans réseau).
pub fn lfs_checkout(repo: &Repository) -> Result<(), GitError> {
    if !uses_lfs(repo) || lfs_version().is_none() {
        return Ok(());
    }
    let dir = workdir(repo)?;
    let mut cmd = git(&dir, None);
    cmd.args(["lfs", "checkout"]);
    run(cmd)?;
    refresh_index(&dir);
    Ok(())
}

/// Télécharge les objets LFS de la révision courante et met à jour la copie de travail.
pub fn lfs_pull(repo: &Repository, creds: Option<&Credentials>) -> Result<(), GitError> {
    if !uses_lfs(repo) {
        return Ok(());
    }
    ensure_installed()?;
    let dir = workdir(repo)?;
    let mut cmd = git(&dir, creds);
    cmd.args(["lfs", "pull"]);
    run(cmd)?;
    refresh_index(&dir);
    Ok(())
}

/// Envoie les objets LFS référencés par `branch` (à faire avant de pousser les commits).
pub fn lfs_push(repo: &Repository, remote: &str, branch: &str, creds: Option<&Credentials>) -> Result<(), GitError> {
    if !uses_lfs(repo) {
        return Ok(());
    }
    if lfs_version().is_none() {
        return Err(GitError::Other(format!(
            "{NOT_INSTALLED}. Sans lui, les fichiers LFS ne seraient pas envoyés au serveur."
        )));
    }
    let mut cmd = git(&workdir(repo)?, creds);
    cmd.args(["lfs", "push", safe_arg(remote)?, safe_arg(branch)?]);
    run(cmd)?;
    Ok(())
}

/// Suit (ou ne suit plus) un motif avec LFS ; modifie .gitattributes.
pub fn lfs_track(repo: &Repository, pattern: &str, untrack: bool) -> Result<(), GitError> {
    ensure_installed()?;
    let dir = workdir(repo)?;
    let mut cmd = git(&dir, None);
    cmd.args(["lfs", if untrack { "untrack" } else { "track" }, safe_arg(pattern.trim())?]);
    run(cmd)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn parses_lfs_patterns() {
        let attrs = "# commentaire\n*.psd filter=lfs diff=lfs merge=lfs -text\n*.txt text\nassets/** filter=lfs diff=lfs merge=lfs -text\n";
        assert_eq!(parse_lfs_patterns(attrs), vec!["*.psd", "assets/**"]);
    }

    #[test]
    fn detects_lfs_paths_from_gitattributes() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        fs::write(dir.path().join(".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n").unwrap();
        assert!(uses_lfs(&repo));
        assert!(is_lfs_path(&repo, "data/model.bin"));
        assert!(!is_lfs_path(&repo, "README.md"));
    }

    #[test]
    fn repo_without_lfs() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        assert!(!uses_lfs(&repo));
        assert!(lfs_status(&repo).unwrap().files.is_empty());
        // Sans LFS, les opérations post-checkout ne font rien.
        lfs_checkout(&repo).unwrap();
        lfs_pull(&repo, None).unwrap();
        lfs_push(&repo, "origin", "main", None).unwrap();
    }

    /// Test d'intégration : nécessite git-lfs (ignoré sinon).
    #[test]
    fn staging_lfs_file_stores_a_pointer() {
        if lfs_version().is_none() {
            eprintln!("git-lfs absent : test ignoré");
            return;
        }
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        lfs_track(&repo, "*.bin", false).unwrap();
        fs::write(dir.path().join("big.bin"), vec![7u8; 4096]).unwrap();

        git_add(&repo, &["big.bin".into(), ".gitattributes".into()]).unwrap();

        let index = repo.index().unwrap();
        let entry = index.get_path(Path::new("big.bin"), 0).unwrap();
        let blob = repo.find_blob(entry.id).unwrap();
        assert!(blob.content().starts_with(b"version https://git-lfs.github.com/spec/v1"));
    }

    /// Bout en bout : indexation par l'app, commit, push (objets LFS + commits), clone, pull LFS.
    #[test]
    fn push_then_clone_round_trips_lfs_content() {
        if lfs_version().is_none() {
            eprintln!("git-lfs absent : test ignoré");
            return;
        }
        use crate::git::{clone_repo, create_commit, push_branch, stage_paths, Credentials};
        fn no_creds(_: &str) -> Option<Credentials> {
            None
        }

        let root = TempDir::new().unwrap();
        let bare = root.path().join("remote.git");
        Repository::init_bare(&bare).unwrap();
        let work_path = root.path().join("work");
        let repo = Repository::init(&work_path).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "T").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();
        repo.remote("origin", bare.to_str().unwrap()).unwrap();

        lfs_track(&repo, "*.bin", false).unwrap();
        let payload = vec![42u8; 10_000];
        fs::write(work_path.join("big.bin"), &payload).unwrap();
        stage_paths(&repo, &["big.bin".into(), ".gitattributes".into()]).unwrap();
        create_commit(&repo, "add big file", false).unwrap();
        let branch = repo.head().unwrap().shorthand().unwrap().to_string();

        lfs_push(&repo, "origin", &branch, None).unwrap();
        push_branch(&repo, "origin", &branch, false, &no_creds).unwrap();

        let clone_path = root.path().join("clone");
        clone_repo(bare.to_str().unwrap(), clone_path.to_str().unwrap(), &no_creds).unwrap();
        let clone = Repository::open(&clone_path).unwrap();
        // libgit2 a écrit le pointeur ; lfs pull récupère le vrai contenu.
        assert_ne!(fs::read(clone_path.join("big.bin")).unwrap(), payload);
        lfs_pull(&clone, None).unwrap();
        assert_eq!(fs::read(clone_path.join("big.bin")).unwrap(), payload);

        let status = lfs_status(&clone).unwrap();
        assert!(status.files.iter().any(|f| f.path == "big.bin" && f.downloaded));
        // Après le pull, libgit2 ne doit pas voir le fichier comme modifié.
        assert!(crate::git::get_status(&clone).unwrap().is_empty());
    }

    fn has_git() -> bool {
        Command::new("git").arg("--version").output().is_ok_and(|o| o.status.success())
    }

    /// Un dépôt dont la config locale tente d'exécuter une commande (fsmonitor, hook) :
    /// avec `git` brut la commande s'exécute, avec notre commande durcie non.
    #[cfg(unix)]
    #[test]
    fn malicious_local_config_is_not_executed() {
        if !has_git() {
            return;
        }
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let marker = dir.path().join("PWNED");
        let script = dir.path().join("evil.sh");
        fs::write(&script, format!("#!/bin/sh\ntouch {}\n", marker.display())).unwrap();
        fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("core.fsmonitor", script.to_str().unwrap()).unwrap();
        cfg.set_str("core.askPass", script.to_str().unwrap()).unwrap();
        cfg.set_str("credential.helper", &format!("!{}", script.display())).unwrap();
        fs::write(dir.path().join("a.txt"), "a").unwrap();

        // Contrôle : git sans protection exécute bien la commande du dépôt.
        Command::new("git").current_dir(dir.path()).args(["status", "--porcelain"]).output().unwrap();
        assert!(marker.exists(), "le test doit d'abord prouver que la config est dangereuse");
        fs::remove_file(&marker).unwrap();

        let mut cmd = git(dir.path(), None);
        cmd.args(["status", "--porcelain"]);
        run(cmd).unwrap();
        let mut cmd = git(dir.path(), None);
        cmd.args(["credential", "fill"]).stdin(std::process::Stdio::null());
        let _ = cmd.output();
        assert!(!marker.exists(), "la configuration locale du dépôt ne doit rien exécuter");
    }

    fn fill(creds: &Credentials, protocol: &str, host: &str) -> String {
        use std::io::Write;
        let dir = TempDir::new().unwrap();
        let mut cmd = git(dir.path(), Some(creds));
        cmd.args(["credential", "fill"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let mut child = cmd.spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(format!("protocol={protocol}\nhost={host}\n\n").as_bytes())
            .unwrap();
        String::from_utf8_lossy(&child.wait_with_output().unwrap().stdout).to_string()
    }

    #[cfg(unix)]
    #[test]
    fn credential_helper_only_answers_for_account_host() {
        if !has_git() {
            return;
        }
        let creds = Credentials {
            username: "oauth2".into(),
            token: "s3cret-token".into(),
            host: "gitlab.example.com".into(),
            allow_http: false,
        };
        assert!(fill(&creds, "https", "gitlab.example.com").contains("password=s3cret-token"));
        assert!(fill(&creds, "https", "GitLab.Example.com:443").contains("password=s3cret-token"));
        assert!(!fill(&creds, "https", "evil.example").contains("s3cret-token"), "autre hôte");
        assert!(!fill(&creds, "http", "gitlab.example.com").contains("s3cret-token"), "en clair");
    }

    #[test]
    fn option_like_arguments_are_rejected() {
        assert!(safe_arg("origin").is_ok());
        assert!(safe_arg("--upload-pack=evil").is_err());
        assert!(safe_arg("a\nb").is_err());
        assert!(safe_arg("").is_err());
    }
}
