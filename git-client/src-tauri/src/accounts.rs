//! Comptes GitHub / GitLab (gitlab.com ou instance auto-hébergée).
//!
//! Les métadonnées (fournisseur, URL, nom d'utilisateur…) sont stockées en JSON dans le
//! dossier de configuration de l'application. Les tokens sont stockés dans le trousseau du
//! système (Secret Service / Keychain / Credential Manager) ; si aucun trousseau n'est
//! disponible, ils sont écrits dans un fichier lisible uniquement par l'utilisateur.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use crate::git::Credentials;
use crate::oauth::{self, OAuthToken};

const KEYRING_SERVICE: &str = "git-client";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Github,
    Gitlab,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuthKind {
    /// Token d'accès personnel saisi par l'utilisateur.
    #[default]
    Pat,
    /// Token obtenu par connexion OAuth (renouvelé automatiquement s'il expire).
    Oauth,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Account {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    /// URL web de l'instance : https://github.com, https://gitlab.com, https://gitlab.mycorp.com
    pub base_url: String,
    pub username: String,
    #[serde(default)]
    pub auth: AuthKind,
}

/// Hôte d'une URL de remote ou d'instance, en minuscules.
/// Gère `https://user@host:port/path`, `ssh://git@host:22/path` et `git@host:owner/repo.git`.
pub fn url_host(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = match url.split_once("://") {
        Some((_, rest)) => rest,
        // Syntaxe scp : git@host:path
        None => url.split_once(':').map(|(host, _)| host)?,
    };
    let authority = rest.split('/').next()?;
    let host_port = authority.rsplit('@').next()?;
    let host = host_port.split(':').next()?;
    if host.is_empty() {
        return None;
    }
    Some(host.to_lowercase())
}

/// URL d'instance acceptable : HTTPS obligatoire, sauf pour la machine locale (tests, dev).
pub fn validate_base_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    let host = url_host(url).ok_or_else(|| format!("URL d'instance invalide : {url}"))?;
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("https://") {
        return Ok(());
    }
    let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]");
    if lower.starts_with("http://") && local {
        return Ok(());
    }
    Err(format!(
        "L'instance doit être en HTTPS ({url}) : en HTTP, les identifiants circuleraient en clair"
    ))
}

pub fn account_for_url<'a>(accounts: &'a [Account], url: &str) -> Option<&'a Account> {
    let host = url_host(url)?;
    accounts.iter().find(|a| url_host(&a.base_url).as_deref() == Some(host.as_str()))
}

/// Nom d'utilisateur HTTPS à présenter avec un token personnel.
pub fn git_username(account: &Account) -> String {
    match account.provider {
        Provider::Github => "x-access-token".into(),
        Provider::Gitlab => "oauth2".into(),
    }
}

/// Compte enregistré et emplacement de son secret.
#[derive(Debug, Serialize, Clone)]
pub struct SavedAccount {
    pub account: Account,
    /// Vrai si le secret est dans le trousseau système ; faux s'il a fallu le fichier de secours.
    pub secure_storage: bool,
}

pub struct AccountStore {
    dir: PathBuf,
}

impl AccountStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn accounts_file(&self) -> PathBuf {
        self.dir.join("accounts.json")
    }

    fn tokens_file(&self) -> PathBuf {
        self.dir.join("tokens.json")
    }

    pub fn list(&self) -> Result<Vec<Account>, String> {
        let path = self.accounts_file();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| format!("accounts.json illisible : {e}"))
    }

    fn write_accounts(&self, accounts: &[Account]) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let raw = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
        std::fs::write(self.accounts_file(), raw).map_err(|e| e.to_string())
    }

    /// Ajoute ou met à jour un compte. Un token `None` conserve le token existant.
    pub fn save(&self, mut account: Account, token: Option<&str>) -> Result<SavedAccount, String> {
        account.base_url = account.base_url.trim().trim_end_matches('/').to_string();
        validate_base_url(&account.base_url)?;
        let mut accounts = self.list()?;
        if account.id.is_empty() {
            account.id = new_id();
        }
        if token.is_none() && !accounts.iter().any(|a| a.id == account.id) {
            return Err("Un token est requis pour un nouveau compte".into());
        }
        let secure_storage = match token {
            Some(token) => self.store_token(&account.id, token)?,
            None => self.secret_in_keyring(&account.id),
        };
        match accounts.iter_mut().find(|a| a.id == account.id) {
            Some(existing) => *existing = account.clone(),
            None => accounts.push(account.clone()),
        }
        self.write_accounts(&accounts)?;
        Ok(SavedAccount { account, secure_storage })
    }

    /// Recherche un compte par identifiant.
    pub fn get(&self, id: &str) -> Result<Account, String> {
        self.list()?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "Compte introuvable".to_string())
    }

    fn secret_in_keyring(&self, id: &str) -> bool {
        keyring::Entry::new(KEYRING_SERVICE, id).and_then(|e| e.get_password()).is_ok()
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let accounts: Vec<Account> = self.list()?.into_iter().filter(|a| a.id != id).collect();
        self.write_accounts(&accounts)?;
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, id) {
            let _ = entry.delete_credential();
        }
        let mut file_tokens = self.read_file_tokens();
        if file_tokens.remove(id).is_some() {
            self.write_file_tokens(&file_tokens)?;
        }
        Ok(())
    }

    fn stored_secret(&self, id: &str) -> Result<String, String> {
        if let Ok(token) = keyring::Entry::new(KEYRING_SERVICE, id).and_then(|e| e.get_password()) {
            return Ok(token);
        }
        self.read_file_tokens()
            .remove(id)
            .ok_or_else(|| "Token introuvable pour ce compte : reconnecte-le".to_string())
    }

    /// Token d'accès utilisable. Un token OAuth expiré est renouvelé (et ré-enregistré).
    pub fn token(&self, id: &str) -> Result<String, String> {
        let secret = self.stored_secret(id)?;
        let Ok(oauth) = serde_json::from_str::<OAuthToken>(&secret) else {
            return Ok(secret); // token personnel
        };
        if !oauth::needs_refresh(&oauth, oauth::now()) {
            return Ok(oauth.access_token);
        }
        let renewed = oauth::refresh(&oauth)
            .map_err(|e| format!("Session OAuth expirée ({e}) : reconnecte le compte"))?;
        self.store_token(id, &serde_json::to_string(&renewed).map_err(|e| e.to_string())?)?;
        Ok(renewed.access_token)
    }

    /// Enregistre un compte connecté par OAuth (le token complet, refresh compris, est stocké).
    pub fn save_oauth(&self, mut account: Account, token: &OAuthToken) -> Result<SavedAccount, String> {
        account.auth = AuthKind::Oauth;
        let secret = serde_json::to_string(token).map_err(|e| e.to_string())?;
        self.save(account, Some(&secret))
    }

    /// Identifiants à utiliser pour une URL de remote, d'après le compte dont l'hôte correspond.
    pub fn credentials_for(&self, url: &str) -> Option<Credentials> {
        let accounts = self.list().ok()?;
        let account = account_for_url(&accounts, url)?;
        let token = self.token(&account.id).ok()?;
        Some(Credentials {
            username: git_username(account),
            token,
            host: url_host(&account.base_url)?,
            allow_http: account.base_url.to_ascii_lowercase().starts_with("http://"),
        })
    }

    /// Stocke le secret ; renvoie vrai s'il est dans le trousseau, faux s'il a fallu le fichier.
    fn store_token(&self, id: &str, token: &str) -> Result<bool, String> {
        let keyring_ok = keyring::Entry::new(KEYRING_SERVICE, id)
            .and_then(|e| e.set_password(token))
            .is_ok();
        let mut tokens = self.read_file_tokens();
        if keyring_ok {
            // Ne laisse pas d'ancienne copie en clair dans le fichier de secours.
            if tokens.remove(id).is_some() {
                self.write_file_tokens(&tokens)?;
            }
            return Ok(true);
        }
        tokens.insert(id.to_string(), token.to_string());
        self.write_file_tokens(&tokens)?;
        Ok(false)
    }

    fn read_file_tokens(&self) -> HashMap<String, String> {
        std::fs::read_to_string(self.tokens_file())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn write_file_tokens(&self, tokens: &HashMap<String, String>) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let path = self.tokens_file();
        let raw = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        std::fs::write(&path, raw).map_err(|e| e.to_string())?;
        restrict_permissions(&path);
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("acc-{nanos:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn account(provider: Provider, base_url: &str) -> Account {
        Account {
            id: String::new(),
            provider,
            label: "test".into(),
            base_url: base_url.into(),
            username: "alice".into(),
            auth: AuthKind::Pat,
        }
    }

    #[test]
    fn url_host_handles_common_remote_formats() {
        assert_eq!(url_host("https://github.com/o/r.git").as_deref(), Some("github.com"));
        assert_eq!(url_host("https://user@GitLab.com/o/r").as_deref(), Some("gitlab.com"));
        assert_eq!(url_host("git@github.com:o/r.git").as_deref(), Some("github.com"));
        assert_eq!(url_host("ssh://git@gitlab.corp.io:2222/g/r.git").as_deref(), Some("gitlab.corp.io"));
        assert_eq!(url_host("https://gitlab.corp.io:8443").as_deref(), Some("gitlab.corp.io"));
        assert_eq!(url_host("/local/path"), None);
    }

    #[test]
    fn account_matching_by_host() {
        let accounts = vec![
            Account { id: "gh".into(), ..account(Provider::Github, "https://github.com") },
            Account { id: "gl".into(), ..account(Provider::Gitlab, "https://gitlab.com") },
            Account { id: "corp".into(), ..account(Provider::Gitlab, "https://git.corp.io") },
        ];
        assert_eq!(account_for_url(&accounts, "git@github.com:o/r.git").unwrap().id, "gh");
        assert_eq!(account_for_url(&accounts, "https://gitlab.com/g/r.git").unwrap().id, "gl");
        assert_eq!(account_for_url(&accounts, "https://git.corp.io/g/r.git").unwrap().id, "corp");
        assert!(account_for_url(&accounts, "https://bitbucket.org/x/y").is_none());
    }

    #[test]
    fn git_username_per_provider() {
        assert_eq!(git_username(&account(Provider::Github, "https://github.com")), "x-access-token");
        assert_eq!(git_username(&account(Provider::Gitlab, "https://gitlab.com")), "oauth2");
    }

    #[test]
    fn metadata_round_trip_and_validation() {
        let dir = TempDir::new().unwrap();
        let store = AccountStore::new(dir.path().to_path_buf());
        assert!(store.list().unwrap().is_empty());

        // Nouveau compte sans token : refusé (avant tout accès au trousseau).
        assert!(store.save(account(Provider::Github, "https://github.com"), None).is_err());
        // URL invalide : refusée.
        assert!(store.save(account(Provider::Gitlab, "not a url/"), Some("t")).is_err());

        // Écriture directe des métadonnées pour ne pas dépendre du trousseau en CI.
        let acc = Account { id: "acc-1".into(), ..account(Provider::Gitlab, "https://git.corp.io") };
        store.write_accounts(std::slice::from_ref(&acc)).unwrap();
        assert_eq!(store.list().unwrap(), vec![acc.clone()]);

        // Mise à jour sans token : conserve le compte, modifie le libellé.
        let renamed = Account { label: "Corp".into(), ..acc };
        store.save(renamed, None).unwrap();
        assert_eq!(store.list().unwrap()[0].label, "Corp");

        store.remove("acc-1").unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn file_token_fallback_is_readable() {
        let dir = TempDir::new().unwrap();
        let store = AccountStore::new(dir.path().to_path_buf());
        let mut tokens = HashMap::new();
        tokens.insert("acc-file".to_string(), "secret".to_string());
        store.write_file_tokens(&tokens).unwrap();
        assert_eq!(store.read_file_tokens().get("acc-file").map(String::as_str), Some("secret"));
    }

    #[test]
    fn legacy_accounts_default_to_pat() {
        let json = r#"[{"id":"a","provider":"github","label":"l","base_url":"https://github.com","username":"u"}]"#;
        let accounts: Vec<Account> = serde_json::from_str(json).unwrap();
        assert_eq!(accounts[0].auth, AuthKind::Pat);
    }

    #[test]
    fn oauth_token_is_unwrapped_from_storage() {
        let dir = TempDir::new().unwrap();
        let store = AccountStore::new(dir.path().to_path_buf());
        let token = OAuthToken {
            access_token: "access".into(),
            refresh_token: None,
            expires_at: None,
            client_id: "c".into(),
            token_url: "u".into(),
        };
        let mut tokens = HashMap::new();
        tokens.insert("oauth-acc".to_string(), serde_json::to_string(&token).unwrap());
        tokens.insert("pat-acc".to_string(), "ghp_plain".to_string());
        store.write_file_tokens(&tokens).unwrap();

        // Le trousseau ne contient pas ces comptes : lecture depuis le fichier de secours.
        assert_eq!(store.token("oauth-acc").unwrap(), "access");
        assert_eq!(store.token("pat-acc").unwrap(), "ghp_plain");
    }

    #[test]
    fn base_url_must_be_https_except_localhost() {
        assert!(validate_base_url("https://gitlab.corp.io").is_ok());
        assert!(validate_base_url("http://gitlab.corp.io").is_err());
        assert!(validate_base_url("http://127.0.0.1:8765").is_ok());
        assert!(validate_base_url("http://localhost:3000").is_ok());
        assert!(validate_base_url("ftp://x.io").is_err());
        assert!(validate_base_url("nope").is_err());
    }
}
