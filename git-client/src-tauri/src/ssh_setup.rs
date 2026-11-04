//! Configuration d'une clé SSH pour un compte : clé du dossier `~/.ssh`, empreinte du serveur et test de connexion.
//!
//! Seuls les noms de `KEY_NAMES` sont utilisés : Merathon (voir `git/auth.rs`) et OpenSSH les trouvent sans aucune
//! configuration, donc `~/.ssh/config` n'est jamais modifié. Une clé existante n'est jamais écrasée, et la clé privée
//! ne quitte jamais ce module : l'interface ne reçoit que la clé publique et le nom du fichier.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use serde::Serialize;
use crate::git::is_plain_file_name;
use ssh_key::{rand_core::OsRng, Algorithm, HashAlg, LineEnding, PrivateKey, PublicKey};

/// Fichiers essayés par défaut, dans l'ordre de `git/auth.rs`.
pub const KEY_NAMES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];
const NEW_KEY: &str = "id_ed25519";

/// Empreintes ED25519 publiées : https://api.github.com/meta et https://docs.gitlab.com/user/gitlab_com/.
const PUBLISHED_FINGERPRINTS: [(&str, &str); 2] = [
    ("github.com", "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"),
    ("gitlab.com", "SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8"),
];

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct SshKeyInfo {
    /// Nom du fichier dans `~/.ssh`.
    pub name: String,
    pub path: String,
    pub public_key: String,
    pub fingerprint: String,
    /// `None` : format de fichier non reconnu (ancienne clé PEM).
    pub encrypted: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SshSetupInfo {
    pub keys: Vec<SshKeyInfo>,
    /// Chemin de la clé à créer ; `None` si `id_ed25519` existe déjà (rien n'est jamais écrasé).
    pub new_key_path: Option<String>,
    pub machine: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum HostStatus {
    Known,
    /// `published` : empreinte vérifiée par rapport à celle publiée par la forge.
    Unknown { fingerprint: String, published: bool },
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct SshCheck {
    pub authenticated: bool,
    pub username: Option<String>,
    pub message: String,
}

/// Dossier `~/.ssh`, comme dans `git/auth.rs`.
pub fn ssh_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    home.map(|h| PathBuf::from(h).join(".ssh")).ok_or_else(|| tr!("Dossier personnel introuvable", "Home folder not found"))
}

fn machine_name() -> String {
    let from_env = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok();
    from_env
        .or_else(|| fs::read_to_string("/etc/hostname").ok())
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "cet ordinateur".to_string())
}

fn key_info(dir: &Path, name: &str) -> Option<SshKeyInfo> {
    let private = dir.join(name);
    if !private.is_file() {
        return None;
    }
    let public_key = fs::read_to_string(dir.join(format!("{name}.pub"))).ok()?.trim().to_string();
    let fingerprint = PublicKey::from_openssh(&public_key).ok()?.fingerprint(HashAlg::Sha256).to_string();
    let encrypted = fs::read_to_string(&private).ok().and_then(|pem| PrivateKey::from_openssh(pem).ok()).map(|k| k.is_encrypted());
    Some(SshKeyInfo { name: name.to_string(), path: private.to_string_lossy().to_string(), public_key, fingerprint, encrypted })
}

pub fn setup_info(dir: &Path) -> SshSetupInfo {
    let keys = KEY_NAMES.iter().filter_map(|name| key_info(dir, name)).collect();
    let target = dir.join(NEW_KEY);
    let taken = target.exists() || dir.join(format!("{NEW_KEY}.pub")).exists();
    SshSetupInfo { keys, new_key_path: (!taken).then(|| target.to_string_lossy().to_string()), machine: machine_name() }
}

/// Toutes les clés de `~/.ssh` (fichier privé et `.pub`), pour en choisir une par profil.
pub fn all_keys(dir: &Path) -> Vec<SshKeyInfo> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".pub").map(str::to_string))
        .collect();
    names.sort();
    names.iter().filter_map(|name| key_info(dir, name)).collect()
}

/// Clé existante désignée par son nom de fichier dans `~/.ssh` : aucun chemin arbitraire n'est accepté.
pub fn existing_key(dir: &Path, name: &str) -> Result<SshKeyInfo, String> {
    if !is_plain_file_name(name) {
        return Err(tr!("Clé SSH refusée : {name}", "SSH key refused: {name}"));
    }
    key_info(dir, name).ok_or_else(|| tr!("Clé SSH introuvable ou sans fichier .pub : {name}", "SSH key not found or without a .pub file: {name}"))
}

/// Crée la clé `name` (`id_ed25519` par défaut) et son `.pub` sans jamais écraser un fichier existant.
pub fn create_key(dir: &Path, name: Option<&str>, comment: &str, passphrase: Option<&str>) -> Result<SshKeyInfo, String> {
    let name = name.unwrap_or(NEW_KEY);
    if !is_plain_file_name(name) || name.ends_with(".pub") {
        return Err(tr!("Nom de clé SSH refusé : {name}", "SSH key name refused: {name}"));
    }
    let private_path = dir.join(name);
    let public_path = dir.join(format!("{name}.pub"));
    if private_path.exists() || public_path.exists() {
        return Err(tr!("{} existe déjà : elle n'est jamais écrasée", "{} already exists: it is never overwritten", private_path.display()));
    }
    create_private_dir(dir)?;

    let mut key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).map_err(|e| e.to_string())?;
    key.set_comment(comment.replace(['\n', '\r'], " "));
    let public = key.public_key().to_openssh().map_err(|e| e.to_string())?;
    let key = match passphrase.filter(|p| !p.is_empty()) {
        Some(p) => key.encrypt(&mut OsRng, p).map_err(|e| e.to_string())?,
        None => key,
    };
    let pem = key.to_openssh(LineEnding::LF).map_err(|e| e.to_string())?;

    write_new(&private_path, pem.as_bytes(), 0o600)?;
    if let Err(e) = write_new(&public_path, format!("{public}\n").as_bytes(), 0o644) {
        let _ = fs::remove_file(&private_path);
        return Err(e);
    }
    key_info(dir, name).ok_or_else(|| tr!("Clé créée mais illisible", "Key created but unreadable"))
}

fn create_private_dir(dir: &Path) -> Result<(), String> {
    if dir.exists() {
        return Ok(());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `create_new` : échoue si le fichier est apparu entre-temps. Sous Unix, les droits sont posés dès la création.
fn write_new(path: &Path, content: &[u8], mode: u32) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(mode);
    }
    #[cfg(not(unix))]
    let _ = mode;
    let mut file = options.open(path).map_err(|e| tr!("{} : {e}", "{}: {e}", path.display()))?;
    file.write_all(content).map_err(|e| e.to_string())
}

/// Hôte d'un compte, tel qu'il sera passé à `ssh` : il ne doit pas pouvoir être pris pour une option.
fn valid_host(host: &str) -> Result<(), String> {
    let ok = !host.is_empty() && !host.starts_with('-') && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c));
    if ok { Ok(()) } else { Err(tr!("Hôte SSH invalide : {host}", "Invalid SSH host: {host}")) }
}

fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn run(mut cmd: Command, program: &str) -> Result<Output, String> {
    cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            tr!("{program} est introuvable : installe OpenSSH pour vérifier la connexion", "{program} not found: install OpenSSH to check the connection")
        } else {
            tr!("{program} : {e}", "{program}: {e}")
        }
    })
}

fn is_known(dir: &Path, host: &str) -> Result<bool, String> {
    let file = dir.join("known_hosts");
    if !file.exists() {
        return Ok(false);
    }
    let mut cmd = command("ssh-keygen");
    cmd.arg("-F").arg(host).arg("-f").arg(file);
    Ok(run(cmd, "ssh-keygen")?.status.success())
}

/// Ligne `hôte ssh-ed25519 AAAA…` et empreinte de sa clé.
fn parse_scan(host: &str, output: &str) -> Result<(String, String), String> {
    for line in output.lines().filter(|l| !l.starts_with('#')) {
        let mut fields = line.split_whitespace();
        let (Some(name), Some(kind), Some(data)) = (fields.next(), fields.next(), fields.next()) else { continue };
        if name != host || kind != "ssh-ed25519" {
            continue;
        }
        let key = PublicKey::from_openssh(&format!("{kind} {data}")).map_err(|e| e.to_string())?;
        return Ok((format!("{name} {kind} {data}"), key.fingerprint(HashAlg::Sha256).to_string()));
    }
    Err(tr!("{host} ne répond pas en SSH sur le port 22, ou ne propose pas de clé ed25519", "{host} does not answer over SSH on port 22, or does not offer an ed25519 key"))
}

fn scan(host: &str) -> Result<(String, String), String> {
    let mut cmd = command("ssh-keyscan");
    cmd.args(["-T", "8", "-t", "ed25519"]).arg(host);
    let output = run(cmd, "ssh-keyscan")?;
    parse_scan(host, &String::from_utf8_lossy(&output.stdout))
}

/// Compare à l'empreinte publiée : `Some(true)` conforme, `None` : aucune publiée pour cet hôte, à faire valider.
fn matches_published(host: &str, fingerprint: &str) -> Result<Option<bool>, String> {
    let Some((_, expected)) = PUBLISHED_FINGERPRINTS.iter().find(|(h, _)| *h == host) else { return Ok(None) };
    if *expected != fingerprint {
        return Err(tr!("L'empreinte reçue de {host} ({fingerprint}) ne correspond pas à celle publiée ({expected}) : la connexion est peut-être interceptée. Configuration interrompue.", "The fingerprint received from {host} ({fingerprint}) does not match the published one ({expected}): the connection may be intercepted. Setup stopped."
        ));
    }
    Ok(Some(true))
}

pub fn host_status(dir: &Path, host: &str) -> Result<HostStatus, String> {
    valid_host(host)?;
    if is_known(dir, host)? {
        return Ok(HostStatus::Known);
    }
    let (_, fingerprint) = scan(host)?;
    let published = matches_published(host, &fingerprint)?.is_some();
    Ok(HostStatus::Unknown { fingerprint, published })
}

/// Ajoute la clé du serveur à `known_hosts`. L'hôte est interrogé à nouveau : seule l'empreinte validée est acceptée.
pub fn trust_host(dir: &Path, host: &str, fingerprint: &str) -> Result<(), String> {
    valid_host(host)?;
    let (line, current) = scan(host)?;
    if current != fingerprint {
        return Err(tr!("L'empreinte de {host} a changé pendant la configuration ({current}) : recommence et vérifie-la.", "The fingerprint of {host} changed during setup ({current}): start again and check it."));
    }
    matches_published(host, &current)?;
    add_known_host(dir, &line)
}

fn add_known_host(dir: &Path, line: &str) -> Result<(), String> {
    create_private_dir(dir)?;
    let file = dir.join("known_hosts");
    let existing = fs::read(&file).unwrap_or_default();
    let separator = if existing.is_empty() || existing.ends_with(b"\n") { "" } else { "\n" };
    let mut options = OpenOptions::new();
    options.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o644);
    }
    let mut out = options.open(&file).map_err(|e| e.to_string())?;
    out.write_all(format!("{separator}{line}\n").as_bytes()).map_err(|e| e.to_string())
}

/// Lit la réponse de `ssh -T` : GitHub termine en code 1 même en cas de succès, seul le texte fait foi.
fn parse_check(output: &str) -> SshCheck {
    let text = output.trim();
    let between = |start: &str, end: char| -> Option<String> {
        let rest = &text[text.find(start)? + start.len()..];
        rest.find(end).map(|i| rest[..i].trim().trim_start_matches('@').to_string()).filter(|n| !n.is_empty())
    };
    let username = between("Hi ", '!').or_else(|| between("Welcome to GitLab, ", '!'));
    let authenticated = username.is_some() || text.contains("successfully authenticated");
    let no_response = tr!("Aucune réponse du serveur", "No response from the server");
    let message = text.lines().rfind(|l| !l.trim().is_empty()).unwrap_or(&no_response).trim().to_string();
    SshCheck { authenticated, username, message }
}

/// Teste la clé auprès du serveur : aucune question (`BatchMode`) et hôte vérifié (`StrictHostKeyChecking`).
pub fn check_connection(dir: &Path, host: &str, key_name: &str) -> Result<SshCheck, String> {
    valid_host(host)?;
    let key = existing_key(dir, key_name)?;
    let mut cmd = command("ssh");
    cmd.args(["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-o", "IdentitiesOnly=yes", "-i"])
        .arg(&key.path)
        .arg(format!("git@{host}"));
    let output = run(cmd, "ssh")?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    Ok(parse_check(&text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SCAN_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

    #[test]
    fn creates_a_key_that_openssh_can_read() {
        let dir = TempDir::new().unwrap();
        let ssh = dir.path().join(".ssh");
        let key = create_key(&ssh, None, "Merathon - poste", None).unwrap();
        assert_eq!(key.name, "id_ed25519");
        assert_eq!(key.encrypted, Some(false));
        assert!(key.public_key.starts_with("ssh-ed25519 ") && key.public_key.ends_with("Merathon - poste"));

        let derived = Command::new("ssh-keygen").arg("-y").arg("-f").arg(&key.path).output();
        if let Ok(out) = derived {
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            assert!(key.public_key.starts_with(String::from_utf8_lossy(&out.stdout).trim()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&key.path).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(&ssh).unwrap().permissions().mode() & 0o777, 0o700);
        }
    }

    #[test]
    fn creates_a_named_key_next_to_the_default_one() {
        let dir = TempDir::new().unwrap();
        create_key(dir.path(), None, "défaut", None).unwrap();
        let key = create_key(dir.path(), Some("id_ed25519_pro"), "pro", None).unwrap();
        assert_eq!(key.name, "id_ed25519_pro");
        assert!(create_key(dir.path(), Some("id_ed25519_pro"), "pro", None).is_err());
        assert!(existing_key(dir.path(), "id_ed25519_pro").is_ok());
    }

    #[test]
    fn protects_the_key_with_the_passphrase() {
        let dir = TempDir::new().unwrap();
        let key = create_key(dir.path(), None, "poste", Some("secret de test")).unwrap();
        assert_eq!(key.encrypted, Some(true));
        let read = |pass: &str| Command::new("ssh-keygen").args(["-y", "-P", pass, "-f"]).arg(&key.path).output();
        if let (Ok(good), Ok(bad)) = (read("secret de test"), read("mauvaise")) {
            assert!(good.status.success());
            assert!(!bad.status.success());
        }
        assert!(!fs::read_to_string(&key.path).unwrap().contains("secret de test"));
    }

    #[test]
    fn never_overwrites_an_existing_key() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("id_ed25519"), "précieuse").unwrap();
        assert!(create_key(dir.path(), None, "x", None).unwrap_err().contains("jamais écrasée"));
        assert_eq!(fs::read_to_string(dir.path().join("id_ed25519")).unwrap(), "précieuse");
        assert!(setup_info(dir.path()).new_key_path.is_none());

        let other = TempDir::new().unwrap();
        fs::write(other.path().join("id_ed25519.pub"), "seule").unwrap();
        assert!(create_key(other.path(), None, "x", None).is_err());
        assert!(!other.path().join("id_ed25519").exists());
    }

    #[test]
    fn lists_only_default_keys_with_their_public_part() {
        let dir = TempDir::new().unwrap();
        create_key(dir.path(), None, "poste", None).unwrap();
        fs::copy(dir.path().join("id_ed25519"), dir.path().join("travail")).unwrap();
        fs::copy(dir.path().join("id_ed25519.pub"), dir.path().join("travail.pub")).unwrap();
        fs::copy(dir.path().join("id_ed25519"), dir.path().join("id_rsa")).unwrap(); // sans .pub
        let info = setup_info(dir.path());
        assert_eq!(info.keys.iter().map(|k| k.name.as_str()).collect::<Vec<_>>(), ["id_ed25519"]);
        assert!(info.keys[0].fingerprint.starts_with("SHA256:"));
        assert!(!serde_json::to_string(&info).unwrap().contains("PRIVATE KEY"));
        // Pour un profil, toutes les clés complètes sont proposées.
        assert_eq!(all_keys(dir.path()).iter().map(|k| k.name.as_str()).collect::<Vec<_>>(), ["id_ed25519", "travail"]);
    }

    #[test]
    fn refuses_any_other_key_path() {
        let dir = TempDir::new().unwrap();
        for bad in ["../secret", "/etc/passwd", "a/b", ""] {
            assert!(existing_key(dir.path(), bad).unwrap_err().contains("refusée"), "{bad}");
            assert!(create_key(dir.path(), Some(bad), "x", None).unwrap_err().contains("refusé"), "{bad}");
        }
        assert!(!dir.path().join("secret").exists());
    }

    #[test]
    fn refuses_hosts_that_could_be_options() {
        for bad in ["-oProxyCommand=x", "", "a b", "a;b", "a/b"] {
            assert!(valid_host(bad).is_err(), "{bad:?}");
        }
        for ok in ["github.com", "gitlab.corp.io", "localhost"] {
            assert!(valid_host(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn reads_the_server_key_from_the_scan() {
        let output = format!("# github.com:22 SSH-2.0\nautre.com ssh-ed25519 {SCAN_KEY}\ngithub.com ssh-ed25519 {SCAN_KEY}\n");
        let (line, fingerprint) = parse_scan("github.com", &output).unwrap();
        assert_eq!(line, format!("github.com ssh-ed25519 {SCAN_KEY}"));
        assert_eq!(fingerprint, PUBLISHED_FINGERPRINTS[0].1);
        assert!(parse_scan("github.com", "").unwrap_err().contains("ne répond pas"));
    }

    #[test]
    fn stops_when_a_known_forge_presents_another_key() {
        assert_eq!(matches_published("github.com", PUBLISHED_FINGERPRINTS[0].1), Ok(Some(true)));
        assert!(matches_published("github.com", "SHA256:autre").unwrap_err().contains("interceptée"));
        assert_eq!(matches_published("gitlab.corp.io", "SHA256:autre"), Ok(None));
    }

    #[test]
    fn appends_to_known_hosts_without_touching_existing_lines() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("known_hosts");
        fs::write(&file, "existant ssh-ed25519 AAAA").unwrap();
        add_known_host(dir.path(), &format!("github.com ssh-ed25519 {SCAN_KEY}")).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), format!("existant ssh-ed25519 AAAA\ngithub.com ssh-ed25519 {SCAN_KEY}\n"));
        if Command::new("ssh-keygen").arg("-?").output().is_ok() {
            assert!(is_known(dir.path(), "github.com").unwrap());
            assert!(!is_known(dir.path(), "gitlab.com").unwrap());
        }
    }

    #[test]
    fn understands_forge_answers() {
        let github = parse_check("Hi camille! You've successfully authenticated, but GitHub does not provide shell access.");
        assert!(github.authenticated);
        assert_eq!(github.username.as_deref(), Some("camille"));

        let gitlab = parse_check("Welcome to GitLab, @camille!");
        assert!(gitlab.authenticated);
        assert_eq!(gitlab.username.as_deref(), Some("camille"));

        let denied = parse_check("\ngit@github.com: Permission denied (publickey).\n");
        assert!(!denied.authenticated);
        assert_eq!(denied.message, "git@github.com: Permission denied (publickey).");
        assert!(!parse_check("").authenticated);
    }
}
