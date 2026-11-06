use std::cell::Cell;
use std::path::{Path, PathBuf};
use git2::{Cred, CredentialType, ProxyOptions, RemoteCallbacks};

/// Proxy résolu comme le fait git : `remote.<nom>.proxy`, `http.proxy`, puis variables d'environnement.
/// Limite de libgit2 : seules les connexions HTTPS passent par le proxy, ni `http://` ni SSH.
pub fn proxy_options<'a>() -> ProxyOptions<'a> {
    let mut proxy = ProxyOptions::new();
    proxy.auto();
    proxy
}

/// Délai maximal pour établir une connexion au serveur.
const CONNECT_TIMEOUT_MS: i32 = 30_000;
/// Délai maximal sans aucune donnée échangée : une connexion muette finit en erreur au lieu de bloquer indéfiniment.
const READ_TIMEOUT_MS: i32 = 120_000;

/// Réglage global de libgit2, à appliquer au démarrage (par défaut, il n'attend jamais de limite).
/// Limite sous Windows : HTTP et HTTPS passent par WinHTTP, qui ignore ces réglages ; seul SSH en profite.
pub fn configure_network_timeouts() -> Result<(), git2::Error> {
    set_network_timeouts(CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS)
}

pub(super) fn set_network_timeouts(connect_ms: i32, read_ms: i32) -> Result<(), git2::Error> {
    // SAFETY : libgit2 lit ces entiers à chaque connexion ; ils sont écrits au démarrage, avant toute opération réseau.
    unsafe {
        git2::opts::set_server_connect_timeout_in_milliseconds(connect_ms)?;
        git2::opts::set_server_timeout_in_milliseconds(read_ms)?;
    }
    Ok(())
}

/// Identifiants HTTPS issus d'un compte enregistré, utilisables uniquement pour son hôte.
#[derive(Clone)]
pub struct Credentials {
    pub username: String,
    pub token: String,
    /// Hôte du compte : le token n'est jamais envoyé à un autre serveur (redirection, LFS…).
    pub host: String,
    /// Autorise l'envoi en clair (http://) : uniquement si le compte lui-même est en http.
    pub allow_http: bool,
}

// Pas de Debug dérivé : le token ne doit jamais apparaître dans un log.
impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials").field("username", &self.username).field("host", &self.host).finish_non_exhaustive()
    }
}

impl Credentials {
    /// Le token peut-il être envoyé à cette URL ?
    pub fn allowed_for(&self, url: &str) -> bool {
        let scheme = url.split_once("://").map(|(s, _)| s.to_ascii_lowercase());
        let secure = match scheme.as_deref() {
            Some("https") => true,
            Some("http") => self.allow_http,
            _ => false,
        };
        secure && crate::accounts::url_host(url).as_deref() == Some(self.host.as_str())
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Candidate {
    Token,
    CredentialHelper,
    SshAgent,
    SshKey(PathBuf),
    /// Clé de l'appareil (Android Keystore), qui signe sans jamais être lue : voir `ssh_signer.rs`.
    #[cfg(any(target_os = "android", test))]
    DeviceKey,
}

/// Clés SSH utilisables. Bureau : agent, clés par défaut de `~/.ssh` et clé du profil. Android : ni agent (il n'y en a
/// pas) ni fichier de clé (jamais de clé en clair sur l'appareil), seulement la clé de l'appareil.
struct SshSources {
    agent: bool,
    key_files: Vec<PathBuf>,
    profile_key: Option<PathBuf>,
    #[cfg(any(target_os = "android", test))]
    device: Option<std::sync::Arc<crate::ssh_signer::SignContext>>,
}

#[cfg(not(target_os = "android"))]
fn ssh_sources(location: &Path) -> SshSources {
    SshSources {
        agent: true,
        key_files: default_ssh_keys(),
        profile_key: super::profiles::ssh_key_for(location),
        #[cfg(test)]
        device: None,
    }
}

#[cfg(target_os = "android")]
fn ssh_sources(_location: &Path) -> SshSources {
    SshSources {
        agent: false,
        key_files: Vec::new(),
        profile_key: None,
        // Clé de l'Android Keystore, si elle existe et reste utilisable (voir android_keystore.rs).
        device: crate::android_keystore::signer().map(crate::ssh_signer::SignContext::new),
    }
}

/// Ordre dans lequel les méthodes d'authentification sont essayées.
/// libgit2 rappelle le callback après chaque échec : on avance d'un cran à chaque appel.
/// `profile_key` : clé du profil du dossier. Elle passe avant l'agent, qui pourrait proposer celle d'un autre compte, et
/// remplace les clés par défaut ; l'agent reste nécessaire pour une clé à passphrase, que Merathon ne peut pas ouvrir.
fn candidates(allowed: CredentialType, has_token: bool, ssh: &SshSources) -> Vec<Candidate> {
    let mut list = Vec::new();
    if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        if has_token {
            list.push(Candidate::Token);
        }
        list.push(Candidate::CredentialHelper);
    }
    #[cfg(any(target_os = "android", test))]
    if ssh.device.is_some() && allowed.contains(CredentialType::SSH_CUSTOM) {
        list.push(Candidate::DeviceKey);
    }
    if allowed.contains(CredentialType::SSH_KEY) {
        if let Some(key) = &ssh.profile_key {
            list.push(Candidate::SshKey(key.clone()));
            if ssh.agent {
                list.push(Candidate::SshAgent);
            }
        } else {
            if ssh.agent {
                list.push(Candidate::SshAgent);
            }
            list.extend(ssh.key_files.iter().cloned().map(Candidate::SshKey));
        }
    }
    list
}

#[cfg(not(target_os = "android"))]
fn default_ssh_keys() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    let Some(home) = home else { return Vec::new() };
    crate::ssh_setup::KEY_NAMES
        .iter()
        .map(|name| PathBuf::from(&home).join(".ssh").join(name))
        .filter(|p| p.exists())
        .collect()
}

/// `location` : dépôt ou cible d'un clone ; il détermine le profil, donc la clé SSH à utiliser.
pub fn remote_callbacks<'a>(creds: Option<Credentials>, location: &Path) -> RemoteCallbacks<'a> {
    remote_callbacks_with(creds, ssh_sources(location))
}

fn remote_callbacks_with<'a>(creds: Option<Credentials>, ssh: SshSources) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    let attempt = Cell::new(0usize);

    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USERNAME) {
            return Cred::username(username_from_url.unwrap_or("git"));
        }

        // Le token n'est proposé qu'au serveur du compte, en HTTPS (pas après une redirection ailleurs).
        let token_ok = creds.as_ref().is_some_and(|c| c.allowed_for(url));
        let list = candidates(allowed, token_ok, &ssh);
        let n = attempt.get();
        attempt.set(n + 1);

        let Some(candidate) = list.get(n) else {
            // Confirmation refusée, clé invalidée… : le message du coffre est plus utile que le refus générique.
            #[cfg(any(target_os = "android", test))]
            if let Some(e) = ssh.device.as_ref().and_then(|d| d.take_error()) {
                return Err(git2::Error::from_str(&e));
            }
            // Android sans clé d'appareil utilisable : le message dit pourquoi (aucune clé, clé effacée, pas de verrouillage d'écran).
            #[cfg(target_os = "android")]
            if allowed.contains(CredentialType::SSH_KEY) && ssh.device.is_none() {
                return Err(git2::Error::from_str(&crate::android_keystore::unusable_key_message(crate::android_keystore::state())));
            }
            return Err(git2::Error::from_str(&tr!("Authentification refusée pour {url} : ajoute un compte avec un token valide pour cet hôte, ou configure une clé SSH", "Authentication refused for {url}: add an account with a valid token for this host, or set up an SSH key"
            )));
        };

        // Avant l'essai : un gestionnaire d'identifiants ou un agent SSH qui ne répond pas reste visible. Jamais de secret ici.
        crate::debug_log::debug(|| format!("auth: trying {candidate:?} for {url}"));

        match candidate {
            Candidate::Token => {
                let c = creds.as_ref().expect("token candidate implies credentials");
                Cred::userpass_plaintext(&c.username, &c.token)
            }
            Candidate::CredentialHelper => {
                let config = git2::Config::open_default()?;
                Cred::credential_helper(&config, url, username_from_url)
            }
            Candidate::SshAgent => Cred::ssh_key_from_agent(username_from_url.unwrap_or("git")),
            Candidate::SshKey(path) => {
                Cred::ssh_key(username_from_url.unwrap_or("git"), None, path, None)
            }
            #[cfg(any(target_os = "android", test))]
            Candidate::DeviceKey => {
                let device = ssh.device.as_ref().expect("device candidate implies a device key");
                device.credential(username_from_url.unwrap_or("git"))
            }
        }
    });

    callbacks
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sources du bureau, comme `ssh_sources` les construit hors Android.
    fn desktop(key_files: &[PathBuf], profile_key: Option<&PathBuf>) -> SshSources {
        SshSources { agent: true, key_files: key_files.to_vec(), profile_key: profile_key.cloned(), device: None }
    }

    /// Sources d'Android, comme `ssh_sources` les construit sur l'appareil (avec ou sans clé de l'appareil).
    fn android(device: bool) -> SshSources {
        let signer = crate::ssh_signer::testing::SoftwareSigner::generate();
        SshSources { agent: false, key_files: Vec::new(), profile_key: None, device: device.then(|| crate::ssh_signer::SignContext::new(signer)) }
    }

    /// Ce que libgit2 annonce quand le serveur SSH accepte les clés publiques.
    const SSH_PUBLICKEY: CredentialType = CredentialType::SSH_KEY.union(CredentialType::SSH_CUSTOM);

    #[test]
    fn https_with_token_tries_token_first() {
        let list = candidates(CredentialType::USER_PASS_PLAINTEXT, true, &desktop(&[], None));
        assert_eq!(list, vec![Candidate::Token, Candidate::CredentialHelper]);
    }

    #[test]
    fn https_without_token_falls_back_to_helper() {
        let list = candidates(CredentialType::USER_PASS_PLAINTEXT, false, &desktop(&[], None));
        assert_eq!(list, vec![Candidate::CredentialHelper]);
    }

    #[test]
    fn profile_key_comes_first_and_replaces_default_keys() {
        let defaults = vec![PathBuf::from("/k/id_ed25519")];
        let key = PathBuf::from("/k/pro");
        let list = candidates(CredentialType::SSH_KEY, false, &desktop(&defaults, Some(&key)));
        assert_eq!(list, vec![Candidate::SshKey(key.clone()), Candidate::SshAgent]);
        // libgit2 annonce aussi SSH_CUSTOM : rien ne change sur le bureau, qui n'a pas de clé d'appareil.
        assert_eq!(candidates(SSH_PUBLICKEY, false, &desktop(&defaults, Some(&key))), list);
    }

    #[test]
    fn ssh_tries_agent_then_key_files() {
        let keys = vec![PathBuf::from("/k/id_ed25519")];
        let list = candidates(CredentialType::SSH_KEY, true, &desktop(&keys, None));
        assert_eq!(list, vec![Candidate::SshAgent, Candidate::SshKey(keys[0].clone())]);
        assert_eq!(candidates(SSH_PUBLICKEY, true, &desktop(&keys, None)), list);
    }

    #[test]
    fn android_only_offers_the_device_key() {
        assert_eq!(candidates(SSH_PUBLICKEY, false, &android(true)), vec![Candidate::DeviceKey]);
        // Sans clé d'appareil : rien, ni agent ni fichier ; libgit2 reçoit le refus clair.
        assert_eq!(candidates(SSH_PUBLICKEY, false, &android(false)), vec![]);
        // Le HTTPS ne change pas.
        assert_eq!(candidates(CredentialType::USER_PASS_PLAINTEXT, true, &android(true)), vec![Candidate::Token, Candidate::CredentialHelper]);
    }

    fn creds(host: &str, allow_http: bool) -> Credentials {
        Credentials { username: "u".into(), token: "secret".into(), host: host.into(), allow_http }
    }

    #[test]
    fn token_only_for_account_host_over_https() {
        let c = creds("github.com", false);
        assert!(c.allowed_for("https://github.com/o/r.git"));
        assert!(!c.allowed_for("http://github.com/o/r.git"), "jamais en clair");
        assert!(!c.allowed_for("https://evil.example/o/r.git"), "autre hôte");
        assert!(!c.allowed_for("https://github.com.evil.example/x"), "suffixe trompeur");
        assert!(!c.allowed_for("git@github.com:o/r.git"), "pas de token en SSH");
    }

    #[test]
    fn http_allowed_only_when_account_is_http() {
        assert!(creds("127.0.0.1", true).allowed_for("http://127.0.0.1:8080/r.git"));
    }

    #[test]
    fn debug_output_hides_token() {
        assert!(!format!("{:?}", creds("github.com", false)).contains("secret"));
    }

    // Parcours Git complet en SSH avec les sources d'Android, contre un vrai serveur OpenSSH (voir test_sshd.rs).

    use crate::ssh_signer::testing::SoftwareSigner;
    use crate::test_sshd::{isolated_home, step, TestSshd};
    use git2::build::RepoBuilder;
    use git2::{FetchOptions, PushOptions, Repository, Signature};
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    fn android_with(signer: &Arc<SoftwareSigner>) -> SshSources {
        SshSources { agent: false, key_files: Vec::new(), profile_key: None, device: Some(crate::ssh_signer::SignContext::new(signer.clone())) }
    }

    fn fetch_options(ssh: SshSources) -> FetchOptions<'static> {
        let mut options = FetchOptions::new();
        options.remote_callbacks(remote_callbacks_with(None, ssh));
        options
    }

    fn commit_file(repo: &Repository, name: &str, content: &str) -> git2::Oid {
        std::fs::write(repo.workdir().unwrap().join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let who = Signature::now("Merathon", "test@merathon.invalid").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &who, &who, &format!("Ajout de {name}"), &tree, &parents).unwrap()
    }

    fn push(repo: &Repository, ssh: SshSources) -> Result<(), git2::Error> {
        let branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let mut options = PushOptions::new();
        options.remote_callbacks(remote_callbacks_with(None, ssh));
        repo.find_remote("origin")?.push(&[format!("refs/heads/{branch}:refs/heads/{branch}")], Some(&mut options))
    }

    /// Récupère origin et avance la branche courante en avance rapide, comme le pull de Merathon sans conflit.
    fn pull(repo: &Repository, ssh: SshSources) -> Result<(), git2::Error> {
        let branch = repo.head()?.shorthand().unwrap().to_string();
        repo.find_remote("origin")?.fetch(&[branch.as_str()], Some(&mut fetch_options(ssh)), None)?;
        let target = repo.find_reference(&format!("refs/remotes/origin/{branch}"))?.target().unwrap();
        repo.find_reference(&format!("refs/heads/{branch}"))?.set_target(target, "pull: fast-forward")?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
    }

    #[test]
    fn clone_fetch_pull_and_push_over_ssh_with_the_device_key() {
        let Some(home) = isolated_home("git::auth::tests::clone_fetch_pull_and_push_over_ssh_with_the_device_key") else { return };
        let signer = SoftwareSigner::generate();
        let Some(server) = TestSshd::start(&[&signer.authorized_key()]) else { return };
        let (bare, url) = server.bare_repo("projet.git");
        let work = tempfile::TempDir::new().unwrap();

        // Dépôt de départ, déposé sur le serveur sans passer par SSH.
        let seed = Repository::init(work.path().join("seed")).unwrap();
        commit_file(&seed, "README.md", "bonjour\n");
        let branch = seed.head().unwrap().shorthand().unwrap().to_string();
        seed.remote("origin", bare.to_str().unwrap()).unwrap().push(&[format!("refs/heads/{branch}:refs/heads/{branch}")], None).unwrap();

        step(format!("Serveur OpenSSH {} sur 127.0.0.1:{} ; clé de l'appareil : {}…", server.version(), server.port, &signer.authorized_key()[..40]));
        // Hôte inconnu : libgit2 refuse la connexion avant toute authentification (comportement actuel d'Android).
        let err = RepoBuilder::new().fetch_options(fetch_options(android_with(&signer))).clone(&url, &work.path().join("refuse")).err().unwrap();
        assert_eq!(err.code(), git2::ErrorCode::Certificate, "{err}");
        assert_eq!(signer.signatures.load(Ordering::SeqCst), 0);
        step(format!("clone avant validation de l'hôte : refusé ({}), aucune signature", err.message()));

        // L'hôte validé (empreinte de la configuration SSH), libgit2 passe l'étape de l'hôte.
        let ssh_dir = home.join(".ssh");
        let crate::ssh_setup::HostStatus::Unknown { fingerprint, .. } = crate::ssh_native::host_status(&ssh_dir, "127.0.0.1", server.port, crate::ssh_native::PROBE_TIMEOUT).unwrap() else { panic!() };
        crate::ssh_native::trust_host(&ssh_dir, "127.0.0.1", server.port, &fingerprint, crate::ssh_native::PROBE_TIMEOUT).unwrap();
        step(format!("hôte validé sans ssh-keyscan : {fingerprint} ajouté à known_hosts"));

        // Clone.
        let a = RepoBuilder::new().fetch_options(fetch_options(android_with(&signer))).clone(&url, &work.path().join("a")).unwrap_or_else(|e| panic!("{e}\n{}", server.log()));
        assert_eq!(std::fs::read_to_string(work.path().join("a/README.md")).unwrap(), "bonjour\n");
        assert!(signer.signatures.load(Ordering::SeqCst) >= 1);
        step(format!("clone {url} ✓ ({} signature)", signer.signatures.load(Ordering::SeqCst)));

        // Push.
        let pushed = commit_file(&a, "depuis-android.txt", "poussé en SSH\n");
        push(&a, android_with(&signer)).unwrap();
        assert_eq!(Repository::open_bare(&bare).unwrap().refname_to_id(&format!("refs/heads/{branch}")).unwrap(), pushed);
        step(format!("push {branch} ✓ → {}", &pushed.to_string()[..8]));

        // Second clone, puis fetch + avance rapide (pull) d'un commit poussé depuis le premier.
        let b = RepoBuilder::new().fetch_options(fetch_options(android_with(&signer))).clone(&url, &work.path().join("b")).unwrap();
        let next = commit_file(&a, "suite.txt", "encore\n");
        push(&a, android_with(&signer)).unwrap();
        pull(&b, android_with(&signer)).unwrap();
        assert_eq!(b.head().unwrap().target().unwrap(), next);
        assert_eq!(std::fs::read_to_string(work.path().join("b/suite.txt")).unwrap(), "encore\n");
        step(format!("second clone, puis fetch + pull ✓ → {}", &next.to_string()[..8]));

        // Confirmation refusée : le push s'arrête avec le message du coffre, sans rien changer.
        signer.refuse.store(true, Ordering::SeqCst);
        let refused = commit_file(&a, "refuse.txt", "non\n");
        let err = push(&a, android_with(&signer)).unwrap_err();
        assert!(err.message().contains("Confirmation annulée"), "{err}");
        assert_eq!(Repository::open_bare(&bare).unwrap().refname_to_id(&format!("refs/heads/{branch}")).unwrap(), next);
        assert_eq!(a.refname_to_id(&format!("refs/remotes/origin/{branch}")).unwrap(), next, "état local cohérent");
        step(format!("confirmation refusée : push arrêté (« {} »), serveur et dépôt local inchangés", err.message()));
        signer.refuse.store(false, Ordering::SeqCst);
        push(&a, android_with(&signer)).unwrap();
        assert_eq!(Repository::open_bare(&bare).unwrap().refname_to_id(&format!("refs/heads/{branch}")).unwrap(), refused);
        step("confirmation acceptée : le même push part ✓");

        // Synchronisation en arrière-plan, confirmation expirée : aucune demande, échec reconnaissable, rien de changé.
        signer.locked.store(true, Ordering::SeqCst);
        let before = signer.signatures.load(Ordering::SeqCst);
        let err = crate::ssh_signer::without_prompt(|| pull(&b, android_with(&signer))).unwrap_err();
        assert!(err.message().contains(crate::android_keystore::LOCKED_MARKER), "{err}");
        assert_eq!(signer.signatures.load(Ordering::SeqCst), before, "aucune signature, donc aucune confirmation");
        assert_eq!(b.head().unwrap().target().unwrap(), next, "dépôt inchangé");
        step(format!("synchronisation en arrière-plan, clé verrouillée : ignorée sans confirmation (« {} »)", err.message()));
        // Le même pull lancé par l'utilisateur peut demander la confirmation, et passe.
        pull(&b, android_with(&signer)).unwrap();
        assert_eq!(b.head().unwrap().target().unwrap(), refused);
        signer.locked.store(false, Ordering::SeqCst);
        step("même pull lancé à la main : confirmation demandée, pull ✓");

        // Clé non ajoutée sur la forge, ou pas de clé d'appareil : refus clair, aucune signature.
        let stranger = SoftwareSigner::generate();
        let err = RepoBuilder::new().fetch_options(fetch_options(android_with(&stranger))).clone(&url, &work.path().join("c")).err().unwrap();
        assert!(err.message().contains("Authentification refusée"), "{err}");
        assert_eq!(stranger.signatures.load(Ordering::SeqCst), 0);
        step("clé absente de la forge : refus clair, aucune confirmation demandée");
        let no_device = SshSources { agent: false, key_files: Vec::new(), profile_key: None, device: None };
        let err = RepoBuilder::new().fetch_options(fetch_options(no_device)).clone(&url, &work.path().join("d")).err().unwrap();
        assert!(err.message().contains("Authentification refusée"), "{err}");

        // La clé n'a jamais été écrite sur le disque : ~/.ssh ne contient que known_hosts.
        let files: Vec<String> = std::fs::read_dir(&ssh_dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(files, ["known_hosts"]);
        step("~/.ssh ne contient que known_hosts : la clé privée n'a jamais touché le disque");
    }
}
