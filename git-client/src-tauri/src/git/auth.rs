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
}

/// Ordre dans lequel les méthodes d'authentification sont essayées.
/// libgit2 rappelle le callback après chaque échec : on avance d'un cran à chaque appel.
/// `profile_key` : clé du profil du dossier. Elle passe avant l'agent, qui pourrait proposer celle d'un autre compte, et
/// remplace les clés par défaut ; l'agent reste nécessaire pour une clé à passphrase, que Merathon ne peut pas ouvrir.
fn candidates(allowed: CredentialType, has_token: bool, ssh_keys: &[PathBuf], profile_key: Option<&PathBuf>) -> Vec<Candidate> {
    let mut list = Vec::new();
    if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
        if has_token {
            list.push(Candidate::Token);
        }
        list.push(Candidate::CredentialHelper);
    }
    if allowed.contains(CredentialType::SSH_KEY) {
        if let Some(key) = profile_key {
            list.push(Candidate::SshKey(key.clone()));
            list.push(Candidate::SshAgent);
        } else {
            list.push(Candidate::SshAgent);
            list.extend(ssh_keys.iter().cloned().map(Candidate::SshKey));
        }
    }
    list
}

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
    let mut callbacks = RemoteCallbacks::new();
    let attempt = Cell::new(0usize);
    let ssh_keys = default_ssh_keys();
    let profile_key = super::profiles::ssh_key_for(location);

    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USERNAME) {
            return Cred::username(username_from_url.unwrap_or("git"));
        }

        // Le token n'est proposé qu'au serveur du compte, en HTTPS (pas après une redirection ailleurs).
        let token_ok = creds.as_ref().is_some_and(|c| c.allowed_for(url));
        let list = candidates(allowed, token_ok, &ssh_keys, profile_key.as_ref());
        let n = attempt.get();
        attempt.set(n + 1);

        let Some(candidate) = list.get(n) else {
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
        }
    });

    callbacks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_with_token_tries_token_first() {
        let list = candidates(CredentialType::USER_PASS_PLAINTEXT, true, &[], None);
        assert_eq!(list, vec![Candidate::Token, Candidate::CredentialHelper]);
    }

    #[test]
    fn https_without_token_falls_back_to_helper() {
        let list = candidates(CredentialType::USER_PASS_PLAINTEXT, false, &[], None);
        assert_eq!(list, vec![Candidate::CredentialHelper]);
    }

    #[test]
    fn profile_key_comes_first_and_replaces_default_keys() {
        let defaults = vec![PathBuf::from("/k/id_ed25519")];
        let key = PathBuf::from("/k/pro");
        let list = candidates(CredentialType::SSH_KEY, false, &defaults, Some(&key));
        assert_eq!(list, vec![Candidate::SshKey(key), Candidate::SshAgent]);
    }

    #[test]
    fn ssh_tries_agent_then_key_files() {
        let keys = vec![PathBuf::from("/k/id_ed25519")];
        let list = candidates(CredentialType::SSH_KEY, true, &keys, None);
        assert_eq!(list, vec![Candidate::SshAgent, Candidate::SshKey(keys[0].clone())]);
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
}
