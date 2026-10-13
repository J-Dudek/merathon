//! Connexion OAuth par « device flow » (RFC 8628), pour GitHub et GitLab.
//!
//! L'application affiche un code, l'utilisateur l'entre dans son navigateur, et on interroge le
//! serveur jusqu'à obtenir un token. Aucun secret n'est embarqué : seul l'identifiant public
//! (client_id) d'une application OAuth enregistrée sur la forge est nécessaire.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::accounts::{url_host, Provider};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

/// Token OAuth stocké dans le trousseau (sérialisé en JSON).
#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Expiration (timestamp Unix, secondes) ; absent si le token n'expire pas (GitHub).
    pub expires_at: Option<i64>,
    pub client_id: String,
    pub token_url: String,
}

// Pas de Debug dérivé : les tokens ne doivent jamais apparaître dans un log.
impl std::fmt::Debug for OAuthToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OAuthToken").field("expires_at", &self.expires_at).finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Endpoints {
    pub device_url: String,
    pub token_url: String,
    pub user_url: String,
    pub scope: &'static str,
}

#[derive(Debug, PartialEq)]
pub enum PollOutcome {
    Pending,
    SlowDown,
    Token(OAuthToken),
    Failed(String),
}

pub fn endpoints(provider: Provider, base_url: &str) -> Endpoints {
    let base = base_url.trim_end_matches('/');
    match provider {
        Provider::Github => {
            // github.com : API sur api.github.com ; GitHub Enterprise : <instance>/api/v3
            let api = if url_host(base).as_deref() == Some("github.com") {
                "https://api.github.com".to_string()
            } else {
                format!("{base}/api/v3")
            };
            Endpoints {
                device_url: format!("{base}/login/device/code"),
                token_url: format!("{base}/login/oauth/access_token"),
                user_url: format!("{api}/user"),
                scope: "repo read:user workflow",
            }
        }
        Provider::Gitlab => Endpoints {
            device_url: format!("{base}/oauth/authorize_device"),
            token_url: format!("{base}/oauth/token"),
            user_url: format!("{base}/api/v4/user"),
            scope: "api read_user write_repository",
        },
    }
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// POST de formulaire ; renvoie le JSON même pour une réponse 4xx (les erreurs OAuth y sont décrites).
fn post_form(url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    let response = crate::http::agent()
        .post(url)
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(30))
        .send_form(form);
    let response = match response {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("Impossible de joindre {url} : {e}")),
    };
    response
        .into_json::<Value>()
        .map_err(|e| format!("Réponse inattendue de {url} : {e}"))
}

fn oauth_error(json: &Value) -> Option<String> {
    let error = json.get("error")?.as_str()?;
    let description = json.get("error_description").and_then(Value::as_str).unwrap_or(error);
    Some(match error {
        // GitHub répond "Not Found" pour un client_id inconnu.
        "invalid_client" | "unauthorized_client" | "Not Found" | "device_flow_disabled" => format!(
            "Application OAuth refusée ({description}). Vérifie l'identifiant client et que le device flow est activé."
        ),
        _ => description.to_string(),
    })
}

/// Demande un code à afficher à l'utilisateur.
pub fn start(endpoints: &Endpoints, client_id: &str) -> Result<DeviceCode, String> {
    let json = post_form(&endpoints.device_url, &[("client_id", client_id), ("scope", endpoints.scope)])?;
    if let Some(err) = oauth_error(&json) {
        return Err(err);
    }
    serde_json::from_value(json).map_err(|e| format!("Réponse de device flow invalide : {e}"))
}

pub fn parse_token_response(json: &Value, client_id: &str, token_url: &str, now: i64) -> PollOutcome {
    if let Some(access_token) = json.get("access_token").and_then(Value::as_str) {
        return PollOutcome::Token(OAuthToken {
            access_token: access_token.to_string(),
            refresh_token: json.get("refresh_token").and_then(Value::as_str).map(str::to_string),
            expires_at: json.get("expires_in").and_then(Value::as_i64).map(|s| now + s),
            client_id: client_id.to_string(),
            token_url: token_url.to_string(),
        });
    }
    match json.get("error").and_then(Value::as_str) {
        Some("authorization_pending") => PollOutcome::Pending,
        Some("slow_down") => PollOutcome::SlowDown,
        Some("expired_token") => PollOutcome::Failed("Le code a expiré : recommence la connexion".into()),
        Some("access_denied") => PollOutcome::Failed("Connexion refusée dans le navigateur".into()),
        _ => PollOutcome::Failed(oauth_error(json).unwrap_or_else(|| "Réponse OAuth inattendue".into())),
    }
}

/// Interroge le serveur jusqu'à ce que l'utilisateur ait validé le code (ou expiration / annulation).
pub fn wait_for_token(
    endpoints: &Endpoints,
    client_id: &str,
    device: &DeviceCode,
    cancel: &AtomicBool,
) -> Result<OAuthToken, String> {
    let deadline = Instant::now() + Duration::from_secs(device.expires_in.max(1));
    let mut interval = Duration::from_secs(device.interval.max(1));
    loop {
        // Attente découpée pour réagir vite à une annulation.
        let wake = Instant::now() + interval;
        while Instant::now() < wake {
            if cancel.load(Ordering::Relaxed) {
                return Err("Connexion annulée".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if Instant::now() > deadline {
            return Err("Le code a expiré : recommence la connexion".into());
        }
        let json = post_form(
            &endpoints.token_url,
            &[
                ("client_id", client_id),
                ("device_code", &device.device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )?;
        match parse_token_response(&json, client_id, &endpoints.token_url, now()) {
            PollOutcome::Pending => {}
            PollOutcome::SlowDown => interval += Duration::from_secs(5),
            PollOutcome::Token(token) => return Ok(token),
            PollOutcome::Failed(e) => return Err(e),
        }
    }
}

pub fn needs_refresh(token: &OAuthToken, now: i64) -> bool {
    token.refresh_token.is_some() && token.expires_at.is_some_and(|exp| now >= exp - 60)
}

pub fn refresh(token: &OAuthToken) -> Result<OAuthToken, String> {
    let refresh_token = token.refresh_token.as_deref().ok_or("Aucun refresh token")?;
    let json = post_form(
        &token.token_url,
        &[("grant_type", "refresh_token"), ("refresh_token", refresh_token), ("client_id", &token.client_id)],
    )?;
    match parse_token_response(&json, &token.client_id, &token.token_url, now()) {
        PollOutcome::Token(mut new) => {
            // Certains serveurs ne renvoient pas de nouveau refresh token.
            if new.refresh_token.is_none() {
                new.refresh_token = token.refresh_token.clone();
            }
            Ok(new)
        }
        _ => Err(oauth_error(&json).unwrap_or_else(|| "Rafraîchissement du token refusé".into())),
    }
}

/// Nom d'utilisateur associé au token.
pub fn fetch_username(provider: Provider, endpoints: &Endpoints, access_token: &str) -> Result<String, String> {
    let json: Value = crate::http::agent()
        .get(&endpoints.user_url)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("Accept", "application/json")
        .set("User-Agent", "Merathon")
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|e| format!("Impossible de lire le profil : {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let field = match provider {
        Provider::Github => "login",
        Provider::Gitlab => "username",
    };
    json.get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Profil utilisateur illisible".into())
}

/// Drapeaux d'annulation des connexions en cours, par device_code.
fn cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    FLAGS.get_or_init(Default::default)
}

pub fn register_cancel(device_code: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_flags().lock().unwrap().insert(device_code.to_string(), flag.clone());
    flag
}

pub fn cancel(device_code: &str) {
    if let Some(flag) = cancel_flags().lock().unwrap().remove(device_code) {
        flag.store(true, Ordering::Relaxed);
    }
}

pub fn unregister(device_code: &str) {
    cancel_flags().lock().unwrap().remove(device_code);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    #[test]
    fn endpoints_per_provider() {
        let gh = endpoints(Provider::Github, "https://github.com");
        assert_eq!(gh.device_url, "https://github.com/login/device/code");
        assert_eq!(gh.user_url, "https://api.github.com/user");
        let ghe = endpoints(Provider::Github, "https://git.corp.io/");
        assert_eq!(ghe.user_url, "https://git.corp.io/api/v3/user");
        let gl = endpoints(Provider::Gitlab, "https://gitlab.corp.io");
        assert_eq!(gl.device_url, "https://gitlab.corp.io/oauth/authorize_device");
        assert_eq!(gl.token_url, "https://gitlab.corp.io/oauth/token");
    }

    #[test]
    fn token_response_parsing() {
        let token = parse_token_response(
            &json!({"access_token": "abc", "refresh_token": "r", "expires_in": 7200}),
            "cid",
            "https://x/oauth/token",
            1000,
        );
        match token {
            PollOutcome::Token(t) => {
                assert_eq!(t.access_token, "abc");
                assert_eq!(t.expires_at, Some(8200));
                assert_eq!(t.refresh_token.as_deref(), Some("r"));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(parse_token_response(&json!({"error": "authorization_pending"}), "c", "u", 0), PollOutcome::Pending);
        assert_eq!(parse_token_response(&json!({"error": "slow_down"}), "c", "u", 0), PollOutcome::SlowDown);
        assert!(matches!(parse_token_response(&json!({"error": "access_denied"}), "c", "u", 0), PollOutcome::Failed(_)));
    }

    #[test]
    fn unknown_client_gives_actionable_message() {
        let msg = oauth_error(&json!({"error": "Not Found"})).unwrap();
        assert!(msg.contains("identifiant client"));
        let msg = oauth_error(&json!({"error": "invalid_client", "error_description": "unknown client"})).unwrap();
        assert!(msg.contains("unknown client"));
    }

    #[test]
    fn refresh_window() {
        let mut t = OAuthToken {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: Some(1000),
            client_id: "c".into(),
            token_url: "u".into(),
        };
        assert!(!needs_refresh(&t, 900));
        assert!(needs_refresh(&t, 950));
        t.expires_at = None;
        assert!(!needs_refresh(&t, 5000), "token sans expiration (GitHub)");
    }

    /// Serveur HTTP minimal qui rejoue des réponses JSON dans l'ordre et note les chemins appelés.
    fn mock_server(responses: Vec<(u16, Value)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut paths = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                paths.push(request_line.split_whitespace().nth(1).unwrap_or("").to_string());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut body_in = vec![0; length];
                reader.read_exact(&mut body_in).unwrap();
                let body = body.to_string();
                write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
            paths
        });
        (base, handle)
    }

    #[test]
    fn full_device_flow_against_mock_gitlab() {
        let (base, server) = mock_server(vec![
            (200, json!({"device_code": "dev", "user_code": "ABCD-1234", "verification_uri": "http://x/activate", "expires_in": 60, "interval": 1})),
            (400, json!({"error": "authorization_pending"})),
            (200, json!({"access_token": "tok", "refresh_token": "ref", "expires_in": 7200})),
            (200, json!({"username": "carol"})),
            (200, json!({"access_token": "tok2", "expires_in": 7200})),
        ]);
        let ep = endpoints(Provider::Gitlab, &base);

        let device = start(&ep, "cid").unwrap();
        assert_eq!(device.user_code, "ABCD-1234");

        let token = wait_for_token(&ep, "cid", &device, &AtomicBool::new(false)).unwrap();
        assert_eq!(token.access_token, "tok");
        assert_eq!(fetch_username(Provider::Gitlab, &ep, &token.access_token).unwrap(), "carol");

        let refreshed = refresh(&token).unwrap();
        assert_eq!(refreshed.access_token, "tok2");
        assert_eq!(refreshed.refresh_token.as_deref(), Some("ref"), "refresh token conservé");

        let paths = server.join().unwrap();
        assert_eq!(paths, vec!["/oauth/authorize_device", "/oauth/token", "/oauth/token", "/api/v4/user", "/oauth/token"]);
    }

    #[test]
    fn cancel_stops_polling() {
        let device = DeviceCode {
            device_code: "d".into(),
            user_code: "u".into(),
            verification_uri: "v".into(),
            verification_uri_complete: None,
            expires_in: 60,
            interval: 5,
        };
        let flag = register_cancel("d");
        cancel("d");
        let ep = endpoints(Provider::Gitlab, "http://127.0.0.1:9");
        let started = Instant::now();
        assert!(wait_for_token(&ep, "c", &device, &flag).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
