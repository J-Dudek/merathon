//! Réglages du serveur, lus dans l'environnement (posé par `scripts/start-stop-status` du paquet Synology).

use std::net::SocketAddr;
use std::path::PathBuf;

/// Comment l'utilisateur est reconnu (voir `auth.rs`).
#[derive(Clone, Debug, PartialEq)]
pub enum AuthMode {
    /// Aucune : réservé au développement, avec une écoute sur la boucle locale seulement.
    None,
    /// Un secret partagé (Docker).
    Token,
    /// La session DSM de l'utilisateur. Expérimental : non proposé par le paquet, l'essai sur un DSM réel n'a pas abouti (voir docs/nas.fr.md).
    Dsm,
}

impl AuthMode {
    pub fn name(&self) -> &'static str {
        match self {
            AuthMode::None => "none",
            AuthMode::Token => "token",
            AuthMode::Dsm => "dsm",
        }
    }
}

/// Longueur minimale du jeton partagé.
pub const MIN_TOKEN_LEN: usize = 16;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    /// Interface construite par `vite build --mode server`.
    pub web_dir: PathBuf,
    /// Préfixe d'URL du service derrière un reverse proxy (`/merathon`), vide à la racine.
    pub base_path: String,
    /// Dossiers où les dépôts peuvent être ouverts ; vide = aucune restriction (développement).
    pub allowed_roots: Vec<PathBuf>,
    /// Terminal intégré : désactivé tant que l'administrateur ne l'a pas demandé.
    pub terminal: bool,
    pub auth: AuthMode,
    /// Secret du mode `token`.
    pub token: Option<String>,
    /// Réglages du mode `dsm`.
    pub dsm: super::auth::DsmSettings,
    /// Origines autorisées à afficher le service dans un cadre (`frame-ancestors`) : DSM, quand l'application s'y ouvre.
    pub frame_ancestors: String,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn flag(name: &str) -> bool {
    var(name).is_some_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

/// `/merathon/` ou `merathon` → `/merathon` ; `/` ou rien → vide.
pub fn normalize_base_path(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('/');
    if trimmed.is_empty() { String::new() } else { format!("/{trimmed}") }
}

fn list(name: &str) -> Option<Vec<String>> {
    var(name).map(|v| v.split(',').map(|item| item.trim().to_string()).filter(|item| !item.is_empty()).collect())
}

impl Config {
    /// Réglages de développement et de test : boucle locale, sans authentification ni restriction.
    pub fn local(data_dir: PathBuf, web_dir: PathBuf) -> Config {
        Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            config_dir: data_dir.join("config"),
            data_dir,
            web_dir,
            base_path: String::new(),
            allowed_roots: vec![],
            terminal: false,
            auth: AuthMode::None,
            token: None,
            dsm: super::auth::DsmSettings::default(),
            frame_ancestors: "'self'".into(),
        }
    }

    pub fn from_env() -> Result<Config, String> {
        let bind: SocketAddr = var("MERATHON_BIND")
            .unwrap_or_else(|| "127.0.0.1:8765".into())
            .parse()
            .map_err(|e| format!("MERATHON_BIND invalide : {e}"))?;
        let data_dir = match var("MERATHON_DATA_DIR") {
            Some(dir) => PathBuf::from(dir),
            None => PathBuf::from(var("HOME").ok_or("MERATHON_DATA_DIR ou HOME doit être défini")?).join(".local/share/merathon"),
        };
        let config_dir = var("MERATHON_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| data_dir.join("config"));
        let allowed_roots = var("MERATHON_ALLOWED_ROOTS")
            .map(|v| std::env::split_paths(&v).filter(|p| !p.as_os_str().is_empty()).collect())
            .unwrap_or_default();
        let auth = match var("MERATHON_AUTH").as_deref().unwrap_or("token") {
            "none" => AuthMode::None,
            "token" => AuthMode::Token,
            "dsm" => AuthMode::Dsm,
            other => return Err(format!("MERATHON_AUTH inconnu : {other} (none, token ou dsm)")),
        };
        let token = match (var("MERATHON_TOKEN"), var("MERATHON_TOKEN_FILE")) {
            (Some(token), _) => Some(token),
            (None, Some(file)) => Some(std::fs::read_to_string(&file).map_err(|e| format!("{file} : {e}"))?.trim().to_string()),
            (None, None) => None,
        };
        let mut dsm = super::auth::DsmSettings::default();
        if let Some(cgi) = var("MERATHON_DSM_CGI") {
            dsm.cgi = cgi.into();
        }
        if let Some(file) = var("MERATHON_GROUP_FILE") {
            dsm.group_file = file.into();
        }
        dsm.allowed_users = list("MERATHON_ALLOWED_USERS").unwrap_or_default();
        if let Some(groups) = list("MERATHON_ALLOWED_GROUPS") {
            dsm.allowed_groups = groups;
        }
        let config = Config {
            bind,
            config_dir,
            data_dir,
            web_dir: var("MERATHON_WEB_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("dist")),
            base_path: normalize_base_path(&var("MERATHON_BASE_PATH").unwrap_or_default()),
            allowed_roots,
            terminal: flag("MERATHON_TERMINAL"),
            auth,
            token,
            dsm,
            frame_ancestors: var("MERATHON_FRAME_ANCESTORS").unwrap_or_else(|| "'self'".into()),
        };
        config.check()?;
        Ok(config)
    }

    /// Refuse les réglages dangereux plutôt que de démarrer un service ouvert à tous.
    pub fn check(&self) -> Result<(), String> {
        if self.auth == AuthMode::None && !self.bind.ip().is_loopback() {
            return Err("MERATHON_AUTH=none n'est permis que sur une adresse locale (127.0.0.1)".into());
        }
        if self.auth != AuthMode::None && self.allowed_roots.is_empty() {
            return Err("MERATHON_ALLOWED_ROOTS est obligatoire avec une authentification : les dossiers où ouvrir des dépôts".into());
        }
        if self.auth == AuthMode::Token && self.token.as_deref().map_or(0, str::len) < MIN_TOKEN_LEN {
            return Err(format!("MERATHON_TOKEN (ou MERATHON_TOKEN_FILE) doit faire au moins {MIN_TOKEN_LEN} caractères"));
        }
        if self.frame_ancestors.contains([';', '\n', '\r']) {
            return Err("MERATHON_FRAME_ANCESTORS invalide".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(bind: &str, auth: AuthMode) -> Config {
        let mut config = Config::local("/d".into(), "/w".into());
        config.bind = bind.parse().unwrap();
        config.auth = auth;
        config
    }

    #[test]
    fn base_path_is_normalized() {
        assert_eq!(normalize_base_path("merathon"), "/merathon");
        assert_eq!(normalize_base_path("/merathon/"), "/merathon");
        assert_eq!(normalize_base_path(" / "), "");
        assert_eq!(normalize_base_path(""), "");
    }

    #[test]
    fn open_access_is_refused_off_loopback() {
        assert!(config("127.0.0.1:1", AuthMode::None).check().is_ok());
        assert!(config("[::1]:1", AuthMode::None).check().is_ok());
        assert!(config("0.0.0.0:1", AuthMode::None).check().is_err());
        assert!(config("192.168.1.10:1", AuthMode::None).check().is_err());
    }

    #[test]
    fn authentication_requires_roots_and_a_strong_token() {
        let mut c = config("0.0.0.0:1", AuthMode::Dsm);
        assert!(c.check().is_err(), "dossiers autorisés obligatoires");
        c.allowed_roots = vec!["/volume1/git".into()];
        assert!(c.check().is_ok());

        c.auth = AuthMode::Token;
        assert!(c.check().is_err(), "jeton absent");
        c.token = Some("trop-court".into());
        assert!(c.check().is_err());
        c.token = Some("un-jeton-assez-long-pour-passer".into());
        assert!(c.check().is_ok());
    }

    #[test]
    fn frame_ancestors_cannot_inject_directives() {
        let mut c = config("127.0.0.1:1", AuthMode::None);
        c.frame_ancestors = "'self'; script-src *".into();
        assert!(c.check().is_err());
    }
}
