//! Authentification : qui a le droit d'utiliser le service, et en tant que quel utilisateur.
//!
//! - `token` : un secret partagé (Docker, tests). La page de connexion l'échange contre un cookie de session.
//! - `dsm` : la session DSM de l'utilisateur. Le service demande à `authenticate.cgi`, le programme de DSM qui
//!   valide un cookie de session (comme le font les CGI des paquets Synology), de la reconnaître, puis vérifie que
//!   l'utilisateur est autorisé (groupes ou liste d'utilisateurs).
//! - `none` : développement, boucle locale seulement (voir `Config::check`).
//!
//! La protection contre les requêtes forgées depuis un autre site ne repose pas sur le jeton de DSM : toute requête
//! de commande doit porter l'en-tête `X-Merathon-Window`, qu'un autre site ne peut pas poser sans autorisation CORS
//! (jamais donnée), et son `Origin`, quand il y en a un, doit être celui du service.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use axum::http::{header, HeaderMap};
use super::config::{AuthMode, Config};

const SESSION_COOKIE: &str = "merathon_session";
const SESSION_LIFETIME: Duration = Duration::from_secs(12 * 3600);
/// Une session DSM reconnue n'est pas revérifiée à chaque requête.
const DSM_CACHE: Duration = Duration::from_secs(30);
const DSM_TIMEOUT: Duration = Duration::from_secs(5);
/// Une même raison de refus est répétée au plus une fois par minute dans le journal.
const REASON_REPEAT: Duration = Duration::from_secs(60);
/// Pause après un mauvais jeton : freine les essais en série.
const FAILED_LOGIN_DELAY: Duration = Duration::from_millis(800);

#[derive(Clone, Debug)]
pub struct DsmSettings {
    /// `authenticate.cgi` de DSM.
    pub cgi: PathBuf,
    /// Fichier des groupes (`/etc/group`).
    pub group_file: PathBuf,
    pub allowed_users: Vec<String>,
    pub allowed_groups: Vec<String>,
}

impl Default for DsmSettings {
    fn default() -> Self {
        DsmSettings {
            cgi: "/usr/syno/synoman/webman/modules/authenticate.cgi".into(),
            group_file: "/etc/group".into(),
            allowed_users: vec![],
            allowed_groups: vec!["administrators".into()],
        }
    }
}

/// Jeton refusé à la connexion (ou connexion par jeton non active).
#[derive(Debug)]
pub struct LoginRefused;

/// Résultat de la vérification d'une requête.
#[derive(Debug, PartialEq)]
pub enum Access {
    /// Autorisée ; l'utilisateur est connu en mode `dsm`.
    Granted(Option<String>),
    /// Pas (ou plus) connecté.
    Unauthenticated,
    /// Connecté, mais sans le droit d'utiliser Merathon.
    Forbidden(String),
}

pub struct Authenticator {
    mode: AuthMode,
    token: Option<String>,
    dsm: DsmSettings,
    sessions: Mutex<HashMap<String, Instant>>,
    dsm_cache: Mutex<HashMap<u64, (Instant, Access)>>,
    /// Dernière raison d'un refus DSM écrite dans le journal : une même raison n'y revient pas à chaque requête.
    last_reason: Mutex<Option<(Instant, String)>>,
}

/// Comparaison en temps constant (un secret ne doit pas se déduire du temps de réponse).
fn same_secret(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    diff == 0
}

fn random_id() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("générateur aléatoire du système");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// Valeur du cookie `name` dans l'en-tête `Cookie`.
fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    header_text(headers, "cookie")?.split(';').filter_map(|c| c.trim().split_once('=')).find(|(n, _)| *n == name).map(|(_, v)| v)
}

/// Noms des cookies d'un en-tête `Cookie`, sans leurs valeurs (ce sont des secrets de session).
fn cookie_names(header: &str) -> String {
    let names: Vec<&str> = header.split(';').filter_map(|c| c.trim().split_once('=').map(|(name, _)| name)).collect();
    if names.is_empty() { "aucun".into() } else { names.join(", ") }
}

/// Membres d'un groupe selon `/etc/group` (`nom:x:gid:membre1,membre2`).
fn group_members(group_file: &std::path::Path, group: &str) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(group_file) else { return vec![] };
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split(':');
            (fields.next()? == group).then(|| fields.nth(2).unwrap_or_default())
        })
        .flat_map(|members| members.split(',').map(str::to_string).collect::<Vec<_>>())
        .filter(|m| !m.is_empty())
        .collect()
}

impl DsmSettings {
    fn permits(&self, user: &str) -> bool {
        self.allowed_users.iter().any(|u| u == user)
            || self.allowed_groups.iter().any(|g| group_members(&self.group_file, g).iter().any(|m| m == user))
    }
}

impl Authenticator {
    pub fn new(config: &Config) -> Authenticator {
        Authenticator {
            mode: config.auth.clone(),
            token: config.token.clone(),
            dsm: config.dsm.clone(),
            sessions: Mutex::new(HashMap::new()),
            dsm_cache: Mutex::new(HashMap::new()),
            last_reason: Mutex::new(None),
        }
    }

    /// Écrit dans le journal du service pourquoi une connexion DSM est refusée : DSM, lui, n'affiche que « échec ». Jamais la valeur d'un cookie.
    fn explain(&self, reason: &str) {
        let mut last = self.last_reason.lock().unwrap();
        if last.as_ref().is_some_and(|(at, previous)| previous == reason && at.elapsed() < REASON_REPEAT) {
            return;
        }
        eprintln!("Connexion DSM refusée : {reason}");
        *last = Some((Instant::now(), reason.to_string()));
    }

    pub fn mode(&self) -> &AuthMode {
        &self.mode
    }

    /// Vérifie une requête (commande ou WebSocket).
    pub async fn check(&self, headers: &HeaderMap) -> Access {
        match self.mode {
            AuthMode::None => Access::Granted(None),
            AuthMode::Token => self.check_token(headers),
            AuthMode::Dsm => self.check_dsm(headers).await,
        }
    }

    fn check_token(&self, headers: &HeaderMap) -> Access {
        let expected = self.token.as_deref().unwrap_or_default();
        let bearer = header_text(headers, "authorization").and_then(|v| v.strip_prefix("Bearer "));
        if bearer.is_some_and(|given| !expected.is_empty() && same_secret(given, expected)) {
            return Access::Granted(None);
        }
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, expiry| *expiry > Instant::now());
        match cookie(headers, SESSION_COOKIE) {
            Some(id) if sessions.contains_key(id) => Access::Granted(None),
            _ => Access::Unauthenticated,
        }
    }

    /// Échange le jeton contre une session ; renvoie l'en-tête `Set-Cookie`.
    pub async fn login(&self, given: &str, secure: bool, base_path: &str) -> Result<String, LoginRefused> {
        let expected = self.token.as_deref().unwrap_or_default();
        if self.mode != AuthMode::Token || expected.is_empty() || !same_secret(given, expected) {
            tokio::time::sleep(FAILED_LOGIN_DELAY).await;
            return Err(LoginRefused);
        }
        let id = random_id();
        self.sessions.lock().unwrap().insert(id.clone(), Instant::now() + SESSION_LIFETIME);
        let path = if base_path.is_empty() { "/" } else { base_path };
        let secure = if secure { "; Secure" } else { "" };
        Ok(format!("{SESSION_COOKIE}={id}; Path={path}; HttpOnly; SameSite=Strict; Max-Age={}{secure}", SESSION_LIFETIME.as_secs()))
    }

    /// Termine la session du cookie ; renvoie le `Set-Cookie` qui l'efface.
    pub fn logout(&self, headers: &HeaderMap, base_path: &str) -> String {
        if let Some(id) = cookie(headers, SESSION_COOKIE) {
            self.sessions.lock().unwrap().remove(id);
        }
        let path = if base_path.is_empty() { "/" } else { base_path };
        format!("{SESSION_COOKIE}=; Path={path}; HttpOnly; SameSite=Strict; Max-Age=0")
    }

    async fn check_dsm(&self, headers: &HeaderMap) -> Access {
        let cookies = header_text(headers, "cookie").unwrap_or_default();
        let syno_token = header_text(headers, "x-syno-token").unwrap_or_default();
        if cookies.is_empty() {
            self.explain("aucun cookie reçu : le navigateur n'envoie pas la session DSM à cette adresse (autre nom d'hôte que DSM ? HTTP au lieu de HTTPS ?)");
            return Access::Unauthenticated;
        }
        if cookies.contains('\0') || syno_token.contains('\0') {
            return Access::Unauthenticated;
        }
        let remote = header_text(headers, "x-real-ip")
            .or_else(|| header_text(headers, "x-forwarded-for").and_then(|v| v.split(',').next()))
            .unwrap_or("127.0.0.1")
            .trim()
            .to_string();
        let key = {
            let mut hasher = DefaultHasher::new();
            (cookies, syno_token, &remote).hash(&mut hasher);
            hasher.finish()
        };
        {
            let mut cache = self.dsm_cache.lock().unwrap();
            cache.retain(|_, (at, _)| at.elapsed() < DSM_CACHE);
            match cache.get(&key) {
                Some((_, Access::Granted(user))) => return Access::Granted(user.clone()),
                Some((_, Access::Forbidden(user))) => return Access::Forbidden(user.clone()),
                _ => {}
            }
        }
        let access = match self.dsm_user(cookies, syno_token, &remote).await {
            Ok(user) if self.dsm.permits(&user) => Access::Granted(Some(user)),
            Ok(user) => {
                self.explain(&format!(
                    "« {user} » est connu de DSM mais n'est ni dans MERATHON_ALLOWED_USERS ni membre de {} (lu dans {})",
                    self.dsm.allowed_groups.join(", "),
                    self.dsm.group_file.display()
                ));
                Access::Forbidden(user)
            }
            Err(reason) => {
                self.explain(&reason);
                Access::Unauthenticated
            }
        };
        // Seuls les accès reconnus sont gardés : un cookie qui vient d'être invalidé ne doit pas rester valable.
        match &access {
            Access::Granted(user) => self.dsm_cache.lock().unwrap().insert(key, (Instant::now(), Access::Granted(user.clone()))),
            Access::Forbidden(user) => self.dsm_cache.lock().unwrap().insert(key, (Instant::now(), Access::Forbidden(user.clone()))),
            Access::Unauthenticated => None,
        };
        access
    }

    /// Utilisateur de la session DSM, d'après `authenticate.cgi` (qui écrit son nom, ou rien s'il ne la reconnaît pas) ; sinon la raison.
    async fn dsm_user(&self, cookies: &str, syno_token: &str, remote: &str) -> Result<String, String> {
        let cgi = self.dsm.cgi.display().to_string();
        let mut command = tokio::process::Command::new(&self.dsm.cgi);
        command
            .env_clear()
            .env("HTTP_COOKIE", cookies)
            .env("HTTP_X_SYNO_TOKEN", syno_token)
            .env("REMOTE_ADDR", remote)
            .env("REQUEST_METHOD", "GET")
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let output = match tokio::time::timeout(DSM_TIMEOUT, command.output()).await {
            Err(_) => return Err(format!("{cgi} n'a pas répondu en {} s", DSM_TIMEOUT.as_secs())),
            Ok(Err(e)) => return Err(format!("{cgi} introuvable ou non exécutable par l'utilisateur du service : {e}")),
            Ok(Ok(output)) => output,
        };
        let short = |bytes: &[u8]| String::from_utf8_lossy(bytes).trim().chars().take(120).collect::<String>();
        if !output.status.success() {
            return Err(format!("{cgi} a échoué (code {:?}) : {}", output.status.code(), short(&output.stderr)));
        }
        let user = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if user.is_empty() {
            return Err(format!(
                "{cgi} ne reconnaît pas la session (cookies reçus : {}) : session expirée, ou jeton SynoToken exigé en plus du cookie",
                cookie_names(cookies)
            ));
        }
        // Un nom d'utilisateur DSM ne contient ni espace ni caractère de contrôle : autre chose n'en est pas un.
        if user.len() > 64 || user.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(format!("sortie inattendue de {cgi} (pas un nom d'utilisateur) : {}", short(&output.stdout)));
        }
        Ok(user)
    }
}

/// L'origine de la requête (`Origin`), quand il y en a une, est-elle celle du service ?
pub fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = header_text(headers, header::ORIGIN.as_str()) else { return true };
    let forwarded = header_text(headers, "x-forwarded-host");
    let host = forwarded.or_else(|| header_text(headers, header::HOST.as_str())).unwrap_or_default();
    origin.split_once("://").is_some_and(|(_, authority)| authority.eq_ignore_ascii_case(host))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(), HeaderValue::from_str(value).unwrap());
        }
        map
    }

    fn token_auth(token: &str) -> Authenticator {
        let mut config = Config::local("/d".into(), "/w".into());
        config.auth = AuthMode::Token;
        config.token = Some(token.into());
        Authenticator::new(&config)
    }

    #[test]
    fn secrets_compare_exactly() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
        assert!(!same_secret("", "abc"));
    }

    #[test]
    fn cookies_are_parsed_by_name() {
        let h = headers(&[("cookie", "a=1; merathon_session=xyz; b=2")]);
        assert_eq!(cookie(&h, "merathon_session"), Some("xyz"));
        assert_eq!(cookie(&h, "c"), None);
    }

    #[tokio::test]
    async fn token_login_gives_a_session_cookie() {
        let auth = token_auth("un-jeton-assez-long");
        assert_eq!(auth.check(&headers(&[])).await, Access::Unauthenticated);
        assert!(auth.login("mauvais", false, "").await.is_err());

        let set_cookie = auth.login("un-jeton-assez-long", true, "/merathon").await.unwrap();
        assert!(set_cookie.contains("HttpOnly") && set_cookie.contains("SameSite=Strict") && set_cookie.contains("Secure"));
        assert!(set_cookie.contains("Path=/merathon"));
        let session = set_cookie.split(';').next().unwrap().to_string();
        assert_eq!(auth.check(&headers(&[("cookie", &session)])).await, Access::Granted(None));

        let cleared = auth.logout(&headers(&[("cookie", &session)]), "");
        assert!(cleared.contains("Max-Age=0"));
        assert_eq!(auth.check(&headers(&[("cookie", &session)])).await, Access::Unauthenticated);
    }

    #[tokio::test]
    async fn bearer_token_is_accepted() {
        let auth = token_auth("un-jeton-assez-long");
        assert_eq!(auth.check(&headers(&[("authorization", "Bearer un-jeton-assez-long")])).await, Access::Granted(None));
        assert_eq!(auth.check(&headers(&[("authorization", "Bearer autre")])).await, Access::Unauthenticated);
    }

    #[test]
    fn origin_must_match_the_host() {
        assert!(same_origin(&headers(&[("host", "nas:8765")])));
        assert!(same_origin(&headers(&[("host", "nas:8765"), ("origin", "http://nas:8765")])));
        assert!(!same_origin(&headers(&[("host", "nas:8765"), ("origin", "https://evil.example")])));
        // Derrière le reverse proxy de DSM, l'hôte d'origine est transmis.
        assert!(same_origin(&headers(&[("host", "127.0.0.1:8765"), ("x-forwarded-host", "nas.local"), ("origin", "https://nas.local")])));
    }

    #[test]
    fn group_membership_is_read_from_the_group_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("group");
        std::fs::write(&file, "users:x:100:\nadministrators:x:101:admin,bob\ndev:x:102:carol\n").unwrap();
        let settings = DsmSettings { group_file: file, allowed_users: vec!["carol".into()], ..DsmSettings::default() };
        assert!(settings.permits("admin"));
        assert!(settings.permits("bob"));
        assert!(settings.permits("carol"), "utilisateur nommé");
        assert!(!settings.permits("dave"));
        assert!(!settings.permits("administrators"), "un nom de groupe n'est pas un membre");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dsm_session_is_validated_by_the_cgi() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let cgi = dir.path().join("authenticate.cgi");
        std::fs::write(&cgi, "#!/bin/sh\ncase \"$HTTP_COOKIE\" in *id=bonne*) echo admin;; *id=simple*) echo dave;; esac\n").unwrap();
        std::fs::set_permissions(&cgi, std::fs::Permissions::from_mode(0o755)).unwrap();
        let groups = dir.path().join("group");
        std::fs::write(&groups, "administrators:x:101:admin\n").unwrap();

        let mut config = Config::local("/d".into(), "/w".into());
        config.auth = AuthMode::Dsm;
        config.dsm = DsmSettings { cgi, group_file: groups, ..DsmSettings::default() };
        let auth = Authenticator::new(&config);

        assert_eq!(auth.check(&headers(&[])).await, Access::Unauthenticated);
        assert_eq!(auth.check(&headers(&[("cookie", "id=inconnue")])).await, Access::Unauthenticated);
        assert_eq!(auth.check(&headers(&[("cookie", "id=bonne")])).await, Access::Granted(Some("admin".into())));
        assert_eq!(auth.check(&headers(&[("cookie", "id=simple")])).await, Access::Forbidden("dave".into()));
    }

    #[test]
    fn cookie_names_hide_the_values() {
        assert_eq!(cookie_names("id=SECRET1; did=SECRET2"), "id, did");
        assert_eq!(cookie_names(""), "aucun");
    }

    /// Pourquoi DSM refuse doit se lire dans le journal du service, sans jamais y mettre la valeur d'un cookie.
    #[cfg(unix)]
    #[tokio::test]
    async fn refusals_explain_themselves_without_leaking_cookies() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = |name: &str, body: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        };
        let auth_with = |cgi: std::path::PathBuf| {
            let mut config = Config::local("/d".into(), "/w".into());
            config.auth = AuthMode::Dsm;
            config.dsm.cgi = cgi;
            Authenticator::new(&config)
        };

        let reason = auth_with(dir.path().join("absent.cgi")).dsm_user("id=SECRET", "", "1.2.3.4").await.unwrap_err();
        assert!(reason.contains("introuvable ou non exécutable"), "{reason}");

        let reason = auth_with(script("vide.cgi", "exit 0")).dsm_user("id=SECRET; did=AUTRE", "", "1.2.3.4").await.unwrap_err();
        assert!(reason.contains("ne reconnaît pas la session") && reason.contains("id, did"), "{reason}");
        assert!(!reason.contains("SECRET") && !reason.contains("AUTRE"), "valeur de cookie dans le message : {reason}");

        let reason = auth_with(script("echec.cgi", "echo 'Permission denied' >&2; exit 3")).dsm_user("id=SECRET", "", "1.2.3.4").await.unwrap_err();
        assert!(reason.contains("code Some(3)") && reason.contains("Permission denied"), "{reason}");

        let reason = auth_with(script("html.cgi", "echo 'Content-Type: text/html'")).dsm_user("id=SECRET", "", "1.2.3.4").await.unwrap_err();
        assert!(reason.contains("pas un nom d'utilisateur"), "{reason}");

        assert_eq!(auth_with(script("ok.cgi", "echo alice")).dsm_user("id=SECRET", "", "1.2.3.4").await.unwrap(), "alice");
    }

    #[tokio::test]
    async fn a_missing_cgi_means_unauthenticated() {
        let mut config = Config::local("/d".into(), "/w".into());
        config.auth = AuthMode::Dsm;
        config.dsm.cgi = "/nulle/part/authenticate.cgi".into();
        let auth = Authenticator::new(&config);
        assert_eq!(auth.check(&headers(&[("cookie", "id=bonne")])).await, Access::Unauthenticated);
    }
}
