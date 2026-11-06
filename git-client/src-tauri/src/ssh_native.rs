//! SSH sans les programmes d'OpenSSH, pour Android : `ssh-keyscan`, `ssh-keygen -F` et `ssh -T` y sont remplacés par
//! libgit2 (via libssh2, déjà embarqué), qui ouvre la connexion et donne la clé du serveur dans `certificate_check`.
//!
//! Le bureau n'utilise pas ce module : il garde OpenSSH (voir `ssh_setup.rs`). Il est compilé pour Android et pour
//! les tests, qui l'exercent sur Linux contre un vrai serveur OpenSSH (voir `test_sshd.rs`).

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use base64ct::{Base64, Base64Unpadded, Encoding};
use git2::{CertificateCheckStatus, Cred, CredentialType, Direction, ErrorClass, ErrorCode, Remote, RemoteCallbacks};
use ssh_key::sha2::{Digest, Sha256};

use crate::known_hosts::{self, HostKeyStatus};
use crate::ssh_setup::{HostStatus, SshCheck};
use crate::ssh_signer::{SignContext, SshSigner};

/// Sondage de la clé du serveur : même délai que `ssh-keyscan -T 8` sur le bureau.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
/// Test de connexion : il laisse le temps de confirmer l'usage de la clé (empreinte digitale ou code de l'appareil).
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(60);
/// Préfixe stable d'un échec du test de connexion dû à l'hôte (inconnu ou clé modifiée), pas à la clé de l'appareil :
/// « Configurer SSH… » le reconnaît pour marquer l'étape de l'empreinte en échec.
pub const HOST_PROBLEM_MARKER: &str = "ssh-host-problem";
/// Dépôt demandé par le test de connexion : il n'existe pas, seule compte la réponse après l'authentification.
const CHECK_REPOSITORY: &str = "merathon-connection-check.git";
/// Message qui interrompt volontairement la connexion de sondage, avant toute authentification.
const PROBE_ABORT: &str = "merathon: host key captured";

/// Clé publique d'un serveur SSH, au format binaire SSH.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerKey {
    pub key_type: String,
    pub key: Vec<u8>,
}

impl ServerKey {
    /// Le type est lu dans la clé elle-même (première chaîne du format SSH).
    fn from_blob(blob: &[u8]) -> Result<Self, String> {
        let invalid = || tr!("Clé du serveur illisible", "Unreadable server key");
        let len = u32::from_be_bytes(blob.get(..4).ok_or_else(invalid)?.try_into().map_err(|_| invalid())?) as usize;
        let name = blob.get(4..4 + len).ok_or_else(invalid)?;
        let key_type = std::str::from_utf8(name).map_err(|_| invalid())?;
        if key_type.is_empty() || !key_type.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(invalid());
        }
        Ok(ServerKey { key_type: key_type.to_string(), key: blob.to_vec() })
    }

    /// `SHA256:…`, comme `ssh-keygen -l`.
    pub fn fingerprint(&self) -> String {
        format!("SHA256:{}", Base64Unpadded::encode_string(&Sha256::digest(&self.key)))
    }

    /// Ligne `hôte type base64`, au format de `ssh-keyscan`.
    pub fn known_hosts_line(&self, host: &str, port: u16) -> String {
        format!("{} {} {}", known_hosts::host_field(host, port), self.key_type, Base64::encode_string(&self.key))
    }
}

fn ssh_url(user: &str, host: &str, port: u16, path: &str) -> String {
    let host = if host.contains(':') { format!("[{host}]") } else { host.to_string() };
    format!("ssh://{user}@{host}:{port}/{path}")
}

fn not_answering(host: &str, port: u16, detail: &str) -> String {
    tr!("{host} ne répond pas en SSH sur le port {port} ({detail})", "{host} does not answer over SSH on port {port} ({detail})")
}

/// Exécute `job` dans un fil à part et rend la main après `timeout`. Le fil abandonné se termine seul ; `cancelled`
/// lui signale de ne plus rien demander (en particulier aucune confirmation à l'utilisateur).
fn with_timeout<T: Send + 'static>(timeout: Duration, cancelled: Arc<AtomicBool>, job: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(job());
    });
    let result = rx.recv_timeout(timeout).ok();
    if result.is_none() {
        cancelled.store(true, Ordering::SeqCst);
    }
    result
}

/// Remplace `ssh-keyscan` : ouvre une connexion, garde la clé présentée par le serveur et coupe avant de
/// s'authentifier. Aucune clé de l'utilisateur n'est proposée.
pub fn probe(host: &str, port: u16, timeout: Duration) -> Result<ServerKey, String> {
    let url = ssh_url("git", host, port, "");
    let cancelled = Arc::new(AtomicBool::new(false));
    let outcome = with_timeout(timeout, cancelled, move || {
        let captured: Arc<Mutex<Option<Result<ServerKey, String>>>> = Arc::default();
        let store = Arc::clone(&captured);
        let mut callbacks = RemoteCallbacks::new();
        callbacks.certificate_check(move |cert, _| {
            let key = cert.as_hostkey().and_then(|k| k.hostkey()).map(ServerKey::from_blob);
            *store.lock().unwrap_or_else(|e| e.into_inner()) = key;
            Err(git2::Error::from_str(PROBE_ABORT))
        });
        callbacks.credentials(|_, _, _| Err(git2::Error::from_str(PROBE_ABORT)));
        let connected = Remote::create_detached(url.as_str()).and_then(|mut remote| {
            remote.connect_auth(Direction::Fetch, Some(callbacks), None).map(|_| ())
        });
        let key = captured.lock().unwrap_or_else(|e| e.into_inner()).take();
        (key, connected.err().map(|e| e.message().to_string()))
    });
    match outcome {
        None => Err(not_answering(host, port, &tr!("délai de {} s dépassé", "{} s timeout", timeout.as_secs()))),
        Some((Some(key), _)) => key,
        Some((None, error)) => Err(not_answering(host, port, error.as_deref().unwrap_or("?"))),
    }
}

/// Remplace la partie « hôte connu ? » de la configuration SSH : `ssh-keygen -F`, puis `ssh-keyscan` si besoin.
pub fn host_status(dir: &Path, host: &str, port: u16, timeout: Duration) -> Result<HostStatus, String> {
    if known_hosts::is_known(&read_known_hosts(dir)?, host, port) {
        return Ok(HostStatus::Known);
    }
    let key = probe(host, port, timeout)?;
    let fingerprint = key.fingerprint();
    let published = crate::ssh_setup::matches_published(host, &key.key_type, &fingerprint)?.is_some();
    Ok(HostStatus::Unknown { fingerprint, published })
}

/// Ajoute la clé du serveur à `known_hosts`. Le serveur est interrogé à nouveau : seule l'empreinte validée est acceptée.
pub fn trust_host(dir: &Path, host: &str, port: u16, fingerprint: &str, timeout: Duration) -> Result<(), String> {
    let key = probe(host, port, timeout)?;
    let current = key.fingerprint();
    if current != fingerprint {
        return Err(tr!("L'empreinte de {host} a changé pendant la configuration ({current}) : recommence et vérifie-la.", "The fingerprint of {host} changed during setup ({current}): start again and check it."));
    }
    crate::ssh_setup::matches_published(host, &key.key_type, &current)?;
    // Une clé enregistrée entre-temps (autre type, ou changement de clé) n'est jamais complétée ni remplacée ici.
    match known_hosts::lookup(&read_known_hosts(dir)?, host, port, &key.key_type, &key.key) {
        HostKeyStatus::Match => Ok(()),
        HostKeyStatus::Unknown if !known_hosts::is_known(&read_known_hosts(dir)?, host, port) => {
            crate::ssh_setup::add_known_host(dir, &key.known_hosts_line(host, port))
        }
        _ => Err(host_key_changed(host)),
    }
}

fn read_known_hosts(dir: &Path) -> Result<String, String> {
    match fs::read_to_string(dir.join("known_hosts")) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(tr!("known_hosts illisible : {e}", "known_hosts unreadable: {e}")),
    }
}

fn host_key_changed(host: &str) -> String {
    tr!("La clé SSH de {host} ne correspond pas à celle enregistrée : la connexion est peut-être interceptée. Connexion bloquée.", "The SSH key of {host} does not match the recorded one: the connection may be intercepted. Connection blocked.")
}

fn host_not_trusted(host: &str) -> String {
    tr!("{host} n'est pas encore un hôte de confiance : valide d'abord son empreinte.", "{host} is not a trusted host yet: check its fingerprint first.")
}

/// Ce que le test de connexion a observé, en dehors du résultat de libgit2.
#[derive(Default)]
struct CheckTrace {
    host_problem: Option<String>,
    /// Le serveur a demandé une authentification.
    asked: bool,
    /// Le serveur a refusé la clé (libgit2 en redemande une autre).
    refused: bool,
}

/// Remplace `ssh -T` : authentification avec la clé de l'appareil auprès de `host`, puis demande d'un dépôt qui
/// n'existe pas. Une clé acceptée mène à « dépôt introuvable », renvoyé sur stderr par le serveur : c'est un succès.
/// La clé du serveur doit déjà être dans `known_hosts` (comme `StrictHostKeyChecking=yes`).
pub fn check_connection(dir: &Path, host: &str, port: u16, user: &str, signer: Arc<dyn SshSigner>, timeout: Duration) -> Result<SshCheck, String> {
    let known = read_known_hosts(dir)?;
    let url = ssh_url(user, host, port, CHECK_REPOSITORY);
    let (host_owned, user_owned) = (host.to_string(), user.to_string());
    let cancelled = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancelled);
    let outcome = with_timeout(timeout, cancelled, move || {
        let trace: Arc<Mutex<CheckTrace>> = Arc::default();
        let context = SignContext::new(signer);
        let mut callbacks = RemoteCallbacks::new();

        let on_cert = Arc::clone(&trace);
        callbacks.certificate_check(move |cert, _| {
            let key = cert.as_hostkey().and_then(|k| k.hostkey()).map(ServerKey::from_blob);
            let problem = match key {
                Some(Ok(key)) => match known_hosts::lookup(&known, &host_owned, port, &key.key_type, &key.key) {
                    // libgit2 (libssh2) vérifie aussi known_hosts : les deux doivent être d'accord.
                    HostKeyStatus::Match => return Ok(CertificateCheckStatus::CertificatePassthrough),
                    HostKeyStatus::Unknown => host_not_trusted(&host_owned),
                    HostKeyStatus::Mismatch | HostKeyStatus::Revoked => host_key_changed(&host_owned),
                },
                Some(Err(e)) => e,
                None => tr!("Clé du serveur indisponible", "Server key unavailable"),
            };
            on_cert.lock().unwrap_or_else(|e| e.into_inner()).host_problem = Some(problem.clone());
            Err(git2::Error::from_str(&problem))
        });

        let on_cred = Arc::clone(&trace);
        let signing = Arc::clone(&context);
        callbacks.credentials(move |_, _, allowed| {
            if stop.load(Ordering::SeqCst) {
                return Err(git2::Error::from_str("cancelled"));
            }
            if allowed.contains(CredentialType::USERNAME) {
                return Cred::username(&user_owned);
            }
            let mut trace = on_cred.lock().unwrap_or_else(|e| e.into_inner());
            if trace.asked || !allowed.contains(CredentialType::SSH_CUSTOM) {
                trace.refused = true;
                return Err(git2::Error::from_str("merathon: key refused"));
            }
            trace.asked = true;
            drop(trace);
            signing.credential(&user_owned)
        });

        let connected = Remote::create_detached(url.as_str()).and_then(|mut remote| {
            remote.connect_auth(Direction::Fetch, Some(callbacks), None).map(|_| ())
        });
        let trace = std::mem::take(&mut *trace.lock().unwrap_or_else(|e| e.into_inner()));
        (connected, trace, context.take_error())
    });

    let Some((connected, trace, sign_error)) = outcome else {
        return Err(not_answering(host, port, &tr!("délai de {} s dépassé", "{} s timeout", timeout.as_secs())));
    };
    if let Some(problem) = trace.host_problem {
        return Err(format!("{HOST_PROBLEM_MARKER}: {problem}"));
    }
    if let Some(e) = sign_error {
        return Ok(SshCheck { authenticated: false, username: None, message: e });
    }
    let accepted = || SshCheck { authenticated: true, username: None, message: tr!("Clé acceptée par {host}", "Key accepted by {host}") };
    match connected {
        Ok(()) => Ok(accepted()),
        // Authentification réussie : le serveur répond sur stderr que le dépôt n'existe pas.
        Err(e) if trace.asked && !trace.refused && e.code() == ErrorCode::Eof && e.class() == ErrorClass::Ssh => Ok(accepted()),
        Err(_) if trace.refused => Ok(SshCheck {
            authenticated: false,
            username: None,
            message: tr!("{host} refuse la clé de cet appareil : ajoute sa clé publique sur la forge.", "{host} refuses this device's key: add its public key on the forge."),
        }),
        Err(e) if !trace.asked => Err(not_answering(host, port, e.message())),
        Err(e) => Err(tr!("Échec du test de connexion à {host} : {}", "Connection test to {host} failed: {}", e.message())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh_signer::testing::SoftwareSigner;
    use crate::test_sshd::{step, TestSshd};
    use std::net::TcpListener;
    use std::time::Instant;
    use std::path::PathBuf;
    use tempfile::TempDir;

    struct SshDir(PathBuf);
    impl SshDir {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    #[test]
    fn reads_type_and_fingerprint_from_the_raw_key() {
        // Clé ed25519 publiée par GitHub : l'empreinte doit être celle de https://api.github.com/meta.
        let blob = Base64::decode_vec("AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl").unwrap();
        let key = ServerKey::from_blob(&blob).unwrap();
        assert_eq!(key.key_type, "ssh-ed25519");
        assert_eq!(key.fingerprint(), "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU");
        assert_eq!(key.known_hosts_line("github.com", 22), "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl");
        assert!(key.known_hosts_line("git.corp", 2222).starts_with("[git.corp]:2222 ssh-ed25519 "));
        for bad in [&[][..], &[0, 0, 0, 9, b'x'], &[0, 0, 0, 0], &[0, 0, 0, 2, b' ', b'x']] {
            assert!(ServerKey::from_blob(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn builds_ssh_urls() {
        assert_eq!(ssh_url("git", "github.com", 22, ""), "ssh://git@github.com:22/");
        assert_eq!(ssh_url("git", "::1", 2222, "r.git"), "ssh://git@[::1]:2222/r.git");
    }

    #[test]
    fn probe_gives_up_after_the_timeout() {
        // Le port accepte la connexion mais ne parle jamais SSH, comme un réseau qui ne répond plus.
        let silent = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = silent.local_addr().unwrap().port();
        let start = Instant::now();
        let err = probe("127.0.0.1", port, Duration::from_millis(800)).unwrap_err();
        assert!(err.contains("délai") || err.contains("timeout"), "{err}");
        assert!(start.elapsed() < Duration::from_secs(5));
        drop(silent);
    }

    #[test]
    fn probe_reports_a_closed_port() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = probe("127.0.0.1", port, PROBE_TIMEOUT).unwrap_err();
        assert!(err.contains("ne répond pas") || err.contains("does not answer"), "{err}");
    }

    #[test]
    fn check_connection_requires_a_trusted_host_before_any_signature() {
        let Some(server) = TestSshd::start(&[]) else { return };
        let ssh = TempDir::new().unwrap();
        let signer = SoftwareSigner::generate();
        let err = check_connection(ssh.path(), "127.0.0.1", server.port, &server.user, signer.clone(), CHECK_TIMEOUT).unwrap_err();
        assert!(err.starts_with(&format!("{HOST_PROBLEM_MARKER}: ")) && err.contains("pas encore un hôte de confiance"), "{err}");
        assert_eq!(signer.signatures.load(Ordering::SeqCst), 0, "aucune signature avant la vérification de l'hôte");
    }

    /// Parcours complet de `SshSetupDialog` avec un vrai serveur OpenSSH : hôte inconnu, validation de l'empreinte,
    /// test de la clé (refusée, puis acceptée une fois ajoutée), confirmation refusée, puis clé d'hôte modifiée.
    #[test]
    fn setup_flow_against_a_real_openssh_server() {
        // libgit2 vérifie lui aussi known_hosts, dans $HOME/.ssh : comme sur Android, c'est le dossier de Merathon.
        let Some(home) = crate::test_sshd::isolated_home("ssh_native::tests::setup_flow_against_a_real_openssh_server") else { return };
        let signer = SoftwareSigner::generate();
        let Some(server) = TestSshd::start(&[]) else { return };
        let ssh = home.join(".ssh");
        let ssh = SshDir(ssh);
        let (host, port) = ("127.0.0.1", server.port);

        // 1. Hôte inconnu : l'empreinte est celle de la clé du serveur, et aucune forge ne la publie.
        let HostStatus::Unknown { fingerprint, published } = host_status(ssh.path(), host, port, PROBE_TIMEOUT).unwrap() else { panic!("hôte inconnu attendu") };
        assert!(!published);
        assert!(server.fingerprints.contains(&fingerprint), "{fingerprint} absent de {:?}", server.fingerprints);
        step(format!("hôte inconnu, empreinte lue par libgit2 : {fingerprint} (non publiée → validation par l'utilisateur)"));

        // 2. Une empreinte qui n'est pas celle du serveur est refusée, et rien n'est écrit.
        let err = trust_host(ssh.path(), host, port, "SHA256:autre", PROBE_TIMEOUT).unwrap_err();
        assert!(err.contains("a changé"), "{err}");
        assert!(!ssh.path().join("known_hosts").exists());
        step(format!("empreinte erronée refusée : {err}"));

        // 3. L'empreinte validée est enregistrée au format [hôte]:port, et l'hôte devient connu.
        trust_host(ssh.path(), host, port, &fingerprint, PROBE_TIMEOUT).unwrap();
        let line = fs::read_to_string(ssh.path().join("known_hosts")).unwrap();
        assert!(line.starts_with(&format!("[127.0.0.1]:{port} ")), "{line}");
        assert_eq!(host_status(ssh.path(), host, port, PROBE_TIMEOUT).unwrap(), HostStatus::Known);
        trust_host(ssh.path(), host, port, &fingerprint, PROBE_TIMEOUT).unwrap();
        assert_eq!(fs::read_to_string(ssh.path().join("known_hosts")).unwrap(), line, "pas de doublon");
        step(format!("known_hosts : {}…", &line[..60.min(line.len())]));
        if let Some(found) = crate::test_sshd::keygen_find(&ssh.path().join("known_hosts"), host, port) {
            assert!(found, "OpenSSH relit la ligne écrite");
        }

        // 4. Clé pas encore ajoutée sur la forge : refus clair, sans signature demandée.
        let check = check_connection(ssh.path(), host, port, &server.user, signer.clone(), CHECK_TIMEOUT).unwrap();
        assert!(!check.authenticated, "{check:?}");
        assert!(check.message.contains("refuse la clé"), "{}", check.message);
        assert_eq!(signer.signatures.load(Ordering::SeqCst), 0, "libssh2 demande d'abord si la clé est acceptée");
        step(format!("test de connexion, clé pas encore sur la forge : {}", check.message));

        // 5. Clé ajoutée : acceptée, après une seule signature (une seule confirmation de l'utilisateur).
        server.authorize(&signer.authorized_key());
        let check = check_connection(ssh.path(), host, port, &server.user, signer.clone(), CHECK_TIMEOUT).unwrap();
        assert!(check.authenticated, "{check:?}");
        assert_eq!(signer.signatures.load(Ordering::SeqCst), 1);
        step(format!("clé ajoutée sur la forge : {} (1 signature = 1 confirmation)", check.message));

        // 6. Confirmation refusée : l'opération s'arrête avec le message du coffre.
        signer.refuse.store(true, Ordering::SeqCst);
        let check = check_connection(ssh.path(), host, port, &server.user, signer.clone(), CHECK_TIMEOUT).unwrap();
        assert!(!check.authenticated);
        assert_eq!(check.message, "Confirmation annulée");
        step("confirmation refusée : « Confirmation annulée »");
        signer.refuse.store(false, Ordering::SeqCst);

        // 7. Clé d'hôte modifiée : connexion bloquée avant toute signature, sans proposer de l'accepter.
        let before = signer.signatures.load(Ordering::SeqCst);
        let other = crate::test_sshd::other_host_key_line(host, port, &line);
        fs::write(ssh.path().join("known_hosts"), format!("{other}\n")).unwrap();
        let err = check_connection(ssh.path(), host, port, &server.user, signer.clone(), CHECK_TIMEOUT).unwrap_err();
        assert!(err.starts_with(&format!("{HOST_PROBLEM_MARKER}: ")) && err.contains("ne correspond pas"), "{err}");
        assert_eq!(host_status(ssh.path(), host, port, PROBE_TIMEOUT).unwrap(), HostStatus::Known, "aucune proposition d'accepter la nouvelle clé");
        assert!(trust_host(ssh.path(), host, port, &fingerprint, PROBE_TIMEOUT).unwrap_err().contains("ne correspond pas"));
        assert_eq!(fs::read_to_string(ssh.path().join("known_hosts")).unwrap(), format!("{other}\n"), "known_hosts intact");
        assert_eq!(signer.signatures.load(Ordering::SeqCst), before);
        step(format!("clé d'hôte modifiée : {err}"));
    }
}
