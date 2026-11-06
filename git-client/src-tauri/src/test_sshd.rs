//! Serveur OpenSSH jetable pour les tests du SSH Android (`ssh_native.rs`, `git/auth.rs`).
//!
//! Il écoute sur 127.0.0.1, sur un port libre, avec ses propres clés d'hôte et son propre `authorized_keys`, et accepte
//! l'utilisateur courant : libgit2 y exécute de vrais `git-upload-pack` et `git-receive-pack`. Sans `sshd` (Windows,
//! poste sans OpenSSH), les tests concernés sont passés avec un message, sauf si `MERATHON_REQUIRE_SSHD=1` (CI Linux).
//!
//! libgit2 lit `~/.ssh/known_hosts` à partir de `HOME`, une fois par processus : les tests de bout en bout tournent
//! donc dans un processus enfant dont `HOME` est un dossier temporaire (`isolated_home`), jamais celui du poste.

use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tempfile::TempDir;

const ISOLATED: &str = "MERATHON_TEST_ISOLATED_HOME";

fn skip(reason: &str) -> Option<TestSshd> {
    if std::env::var_os("MERATHON_REQUIRE_SSHD").is_some_and(|v| v == "1") {
        panic!("serveur OpenSSH de test indisponible : {reason}");
    }
    eprintln!("test SSH passé : {reason}");
    None
}

fn find(program: &str, candidates: &[&str]) -> Option<PathBuf> {
    candidates.iter().map(PathBuf::from).find(|p| p.is_file()).or_else(|| {
        let out = Command::new("which").arg(program).output().ok()?;
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !path.is_empty()).then(|| PathBuf::from(path))
    })
}

/// Dans le processus de test habituel : relance `test` seul dans un processus enfant dont `HOME` est un dossier
/// temporaire, vérifie qu'il réussit et renvoie `None`. Dans cet enfant : renvoie ce `HOME`, où le test s'exécute.
pub fn isolated_home(test: &str) -> Option<PathBuf> {
    if let Some(home) = std::env::var_os(ISOLATED) {
        return Some(PathBuf::from(home));
    }
    let home = TempDir::new().unwrap();
    let out = Command::new(std::env::current_exe().unwrap())
        .args([test, "--exact", "--nocapture", "--test-threads=1"])
        .env(ISOLATED, home.path())
        .env("HOME", home.path())
        .env_remove("SSH_AUTH_SOCK")
        .env_remove("GIT_SSH_COMMAND")
        .output()
        .unwrap();
    let log = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(out.status.success(), "{test} a échoué dans son processus isolé :\n{log}");
    assert!(log.contains("1 passed"), "{test} ne s'est pas exécuté dans son processus isolé :\n{log}");
    if log.contains("test SSH passé") {
        eprintln!("{test} : serveur OpenSSH indisponible, test passé");
    }
    if demo() {
        eprint!("{}", String::from_utf8_lossy(&out.stderr));
    }
    None
}

fn demo() -> bool {
    std::env::var_os("MERATHON_SSH_DEMO").is_some()
}

/// `MERATHON_SSH_DEMO=1` : raconte le parcours du test, étape par étape (enregistrement de la démo de la PR).
pub fn step(message: impl std::fmt::Display) {
    if demo() {
        eprintln!("▸ {message}");
    }
}

pub struct TestSshd {
    child: Child,
    dir: TempDir,
    pub port: u16,
    pub user: String,
    /// Empreintes `SHA256:…` des clés d'hôte du serveur.
    pub fingerprints: Vec<String>,
}

impl TestSshd {
    pub fn start(authorized: &[&str]) -> Option<TestSshd> {
        let Some(sshd) = find("sshd", &["/usr/sbin/sshd", "/usr/bin/sshd"]) else { return skip("sshd introuvable") };
        if find("ssh-keygen", &[]).is_none() {
            return skip("ssh-keygen introuvable");
        }
        let dir = TempDir::new().unwrap();
        let mut fingerprints = Vec::new();
        let mut host_keys = String::new();
        for kind in ["ed25519", "ecdsa"] {
            let key = dir.path().join(format!("host_{kind}"));
            let ok = Command::new("ssh-keygen").args(["-q", "-t", kind, "-N", "", "-f"]).arg(&key).status().is_ok_and(|s| s.success());
            if !ok {
                return skip("ssh-keygen n'a pas créé les clés d'hôte");
            }
            let out = Command::new("ssh-keygen").args(["-l", "-E", "sha256", "-f"]).arg(key.with_extension("pub")).output().unwrap();
            fingerprints.extend(String::from_utf8_lossy(&out.stdout).split_whitespace().nth(1).map(str::to_string));
            host_keys.push_str(&format!("HostKey {}\n", key.display()));
        }
        let authorized_keys = dir.path().join("authorized_keys");
        fs::write(&authorized_keys, authorized.iter().map(|l| format!("{l}\n")).collect::<String>()).unwrap();

        // SAFETY : simple lecture de l'identifiant effectif du processus.
        #[cfg(unix)]
        let root = unsafe { libc::geteuid() } == 0;
        #[cfg(not(unix))]
        let root = false;
        if root {
            // Dossier de séparation des privilèges, exigé par sshd lancé en root.
            let _ = fs::create_dir_all("/run/sshd");
        }
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let config = dir.path().join("sshd_config");
        fs::write(
            &config,
            format!(
                "Port {port}\nListenAddress 127.0.0.1\n{host_keys}PidFile {pid}\nAuthorizedKeysFile {keys}\n\
                 StrictModes no\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n\
                 PubkeyAuthentication yes\nPermitRootLogin {root_login}\nLogLevel VERBOSE\n",
                pid = dir.path().join("sshd.pid").display(),
                keys = authorized_keys.display(),
                root_login = if root { "prohibit-password" } else { "no" },
            ),
        )
        .unwrap();
        let log = fs::File::create(dir.path().join("sshd.log")).unwrap();
        let child = Command::new(&sshd)
            .args(["-D", "-e", "-f"])
            .arg(&config)
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .spawn();
        let Ok(child) = child else { return skip("sshd ne démarre pas") };
        let user = String::from_utf8_lossy(&Command::new("id").arg("-un").output().unwrap().stdout).trim().to_string();
        let mut server = TestSshd { child, dir, port, user, fingerprints };

        let deadline = Instant::now() + Duration::from_secs(10);
        while TcpStream::connect(("127.0.0.1", port)).is_err() {
            if Instant::now() > deadline || server.child.try_wait().ok().flatten().is_some() {
                let log = fs::read_to_string(server.dir.path().join("sshd.log")).unwrap_or_default();
                return skip(&format!("sshd n'écoute pas sur le port {port} : {log}"));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Some(server)
    }

    /// Ajoute une clé publique à `authorized_keys` (équivalent de l'ajout de la clé sur la forge).
    pub fn authorize(&self, line: &str) {
        let file = self.dir.path().join("authorized_keys");
        let mut content = fs::read_to_string(&file).unwrap_or_default();
        content.push_str(&format!("{line}\n"));
        fs::write(file, content).unwrap();
    }

    /// Dépôt nu servi par ce serveur, et son URL SSH.
    pub fn bare_repo(&self, name: &str) -> (PathBuf, String) {
        let path = self.dir.path().join(name);
        git2::Repository::init_bare(&path).unwrap();
        let url = format!("ssh://{}@127.0.0.1:{}{}", self.user, self.port, path.display());
        (path, url)
    }

    /// Version d'OpenSSH du serveur, pour le récit de la démo.
    pub fn version(&self) -> String {
        let out = Command::new("ssh").arg("-V").output().ok();
        out.map(|o| String::from_utf8_lossy(&o.stderr).split([',', ' ']).next().unwrap_or("").to_string()).unwrap_or_default()
    }

    pub fn log(&self) -> String {
        fs::read_to_string(self.dir.path().join("sshd.log")).unwrap_or_default()
    }
}

impl Drop for TestSshd {
    fn drop(&mut self) {
        // `MERATHON_SSHD_LOG=1` : journal du serveur (connexions, clés acceptées) affiché à la fin du test.
        if std::env::var_os("MERATHON_SSHD_LOG").is_some() {
            eprintln!("--- journal de sshd (port {}) ---\n{}", self.port, self.log());
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// `ssh-keygen -F` sur ce fichier, quand OpenSSH est installé.
pub fn keygen_find(file: &Path, host: &str, port: u16) -> Option<bool> {
    let target = crate::known_hosts::host_field(host, port);
    let out = Command::new("ssh-keygen").arg("-F").arg(&target).arg("-f").arg(file).output().ok()?;
    Some(out.status.success())
}

/// Ligne `known_hosts` pour le même hôte et le même type de clé que `line`, avec une autre clé : un serveur dont la
/// clé a changé (ou une interception).
pub fn other_host_key_line(host: &str, port: u16, line: &str) -> String {
    let key_type = line.split_whitespace().nth(1).unwrap();
    let kind = if key_type.starts_with("ecdsa") { "ecdsa" } else { "ed25519" };
    let dir = TempDir::new().unwrap();
    let key = dir.path().join("other");
    assert!(Command::new("ssh-keygen").args(["-q", "-t", kind, "-N", "", "-f"]).arg(&key).status().unwrap().success());
    let public = fs::read_to_string(key.with_extension("pub")).unwrap();
    let mut fields = public.split_whitespace();
    let (found_type, data) = (fields.next().unwrap(), fields.next().unwrap());
    assert_eq!(found_type, key_type);
    format!("{} {found_type} {data}", crate::known_hosts::host_field(host, port))
}
