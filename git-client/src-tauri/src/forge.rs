//! Appels aux API GitHub / GitLab, faits côté Rust : le token ne quitte jamais le backend.
//! L'interface ne fournit qu'un chemin d'API, toujours appelé sur le serveur du compte.

use std::time::Duration;
use serde_json::Value;
use crate::accounts::{url_host, Account, Provider};

/// Racine de l'API REST d'une instance.
pub fn api_base(provider: Provider, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    match provider {
        Provider::Github if url_host(base).as_deref() == Some("github.com") => "https://api.github.com".into(),
        Provider::Github => format!("{base}/api/v3"),
        Provider::Gitlab => format!("{base}/api/v4"),
    }
}

/// Point d'entrée GraphQL de GitHub : hors de `/api/v3` sur GitHub Enterprise, d'où une route à part.
pub fn graphql_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if url_host(base).as_deref() == Some("github.com") {
        "https://api.github.com/graphql".into()
    } else {
        format!("{base}/api/graphql")
    }
}

/// Chemin d'API relatif (avec éventuelle query string), sans possibilité de viser un autre hôte.
pub fn validate_api_path(path: &str) -> Result<(), String> {
    let refused = || format!("Chemin d'API refusé : {path}");
    if !path.starts_with('/') || path.starts_with("//") || path.len() > 2048 {
        return Err(refused());
    }
    let route = path.split('?').next().unwrap_or("");
    if path.contains("://")
        || path.contains('\\')
        || path.chars().any(|c| c.is_control() || c.is_whitespace())
        || route.split('/').any(|seg| seg == ".." || seg == "." || seg.eq_ignore_ascii_case("%2e%2e"))
    {
        return Err(refused());
    }
    Ok(())
}

fn http_error(host: &str, e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401 | 403, _) => {
            "Token refusé (401/403) : vérifie sa validité et ses droits, ou reconnecte le compte".into()
        }
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|json| api_error_message(&json))
                .unwrap_or_else(|| body.chars().take(200).collect());
            format!("API {host} : erreur {code} {detail}")
        }
        // Le détail distingue une URL erronée d'un certificat non reconnu ou d'un proxy.
        ureq::Error::Transport(t) => format!("Impossible de joindre {host} ({t}) : vérifie l'URL de l'instance et ta connexion"),
    }
}

/// Message lisible d'une erreur d'API : `message` + `errors[].message` (GitHub), `message` texte ou liste (GitLab).
fn api_error_message(json: &Value) -> Option<String> {
    let texts = |v: &Value| -> Vec<String> {
        match v {
            Value::String(s) => vec![s.clone()],
            Value::Array(items) => items
                .iter()
                .filter_map(|i| i.as_str().map(str::to_string).or_else(|| i.get("message")?.as_str().map(str::to_string)))
                .collect(),
            Value::Object(map) => map.iter().map(|(k, v)| format!("{k} {v}")).collect(),
            _ => Vec::new(),
        }
    };
    let mut parts = json.get("message").map(texts).unwrap_or_default();
    parts.extend(json.get("errors").map(texts).unwrap_or_default());
    if parts.is_empty() {
        parts.extend(json.get("error").map(texts).unwrap_or_default());
    }
    (!parts.is_empty()).then(|| parts.join(" — "))
}

/// Méthodes acceptées depuis l'interface : lecture et création / modification, jamais de suppression.
fn validate_method(method: &str) -> Result<(), String> {
    match method {
        "GET" | "POST" | "PUT" | "PATCH" => Ok(()),
        _ => Err(format!("Méthode d'API refusée : {method}")),
    }
}

/// GET JSON authentifié sur l'API du compte.
pub fn get_json(account: &Account, token: &str, path: &str) -> Result<Value, String> {
    request_json(account, token, "GET", path, None)
}

/// Requête JSON authentifiée sur l'API du compte (corps JSON optionnel, réponse vide = `null`).
pub fn request_json(account: &Account, token: &str, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
    validate_method(method)?;
    validate_api_path(path)?;
    let url = format!("{}{}", api_base(account.provider, &account.base_url), path);
    send_json(account, token, method, &url, body)
}

/// Requête GraphQL GitHub. Les erreurs GraphQL arrivent avec un statut 200 : elles sont converties en erreur.
pub fn graphql(account: &Account, token: &str, query: &str, variables: &Value) -> Result<Value, String> {
    if account.provider != Provider::Github {
        return Err("GraphQL n'est utilisé que pour GitHub".into());
    }
    let body = serde_json::json!({ "query": query, "variables": variables });
    let response = send_json(account, token, "POST", &graphql_url(&account.base_url), Some(&body))?;
    if let Some(message) = response.get("errors").filter(|e| e.as_array().is_some_and(|a| !a.is_empty())).and_then(|_| api_error_message(&response)) {
        return Err(format!("API GitHub : {message}"));
    }
    Ok(response.get("data").cloned().unwrap_or(Value::Null))
}

fn send_json(account: &Account, token: &str, method: &str, url: &str, body: Option<&Value>) -> Result<Value, String> {
    let host = url_host(url).unwrap_or_default();
    let mut request = crate::http::agent()
        .request(method, url)
        .timeout(Duration::from_secs(30))
        .set("Authorization", &format!("Bearer {token}"))
        .set("User-Agent", "Merathon");
    request = match account.provider {
        Provider::Github => request
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28"),
        Provider::Gitlab => request.set("Accept", "application/json"),
    };
    let response = match body {
        Some(body) => request.send_json(body),
        None => request.call(),
    }
    .map_err(|e| http_error(&host, e))?;
    let text = response.into_string().map_err(|e| format!("Réponse illisible de {host} : {e}"))?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("Réponse illisible de {host} : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_base_per_provider() {
        assert_eq!(api_base(Provider::Github, "https://github.com"), "https://api.github.com");
        assert_eq!(api_base(Provider::Github, "https://ghe.corp.io/"), "https://ghe.corp.io/api/v3");
        assert_eq!(api_base(Provider::Gitlab, "https://gitlab.com"), "https://gitlab.com/api/v4");
    }

    #[test]
    fn graphql_endpoint_per_instance() {
        assert_eq!(graphql_url("https://github.com"), "https://api.github.com/graphql");
        assert_eq!(graphql_url("https://ghe.corp.io/"), "https://ghe.corp.io/api/graphql");
    }

    #[test]
    fn only_non_destructive_methods() {
        for ok in ["GET", "POST", "PUT", "PATCH"] {
            assert!(validate_method(ok).is_ok(), "{ok}");
        }
        for bad in ["DELETE", "get", "CONNECT", ""] {
            assert!(validate_method(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn readable_api_errors() {
        let github = serde_json::json!({
            "message": "Validation Failed",
            "errors": [{"resource": "PullRequest", "message": "A pull request already exists for o:feat."}],
        });
        assert_eq!(
            api_error_message(&github).unwrap(),
            "Validation Failed — A pull request already exists for o:feat."
        );
        let gitlab = serde_json::json!({"message": ["Another open merge request already exists for this source branch: !3"]});
        assert_eq!(api_error_message(&gitlab).unwrap(), "Another open merge request already exists for this source branch: !3");
        assert_eq!(api_error_message(&serde_json::json!({"error": "insufficient_scope"})).unwrap(), "insufficient_scope");
        assert!(api_error_message(&serde_json::json!({})).is_none());
    }

    #[test]
    fn api_path_validation() {
        for ok in ["/user", "/repos/o/r/pulls?state=open&per_page=50", "/projects/group%2Frepo/issues"] {
            assert!(validate_api_path(ok).is_ok(), "{ok}");
        }
        for bad in [
            "user",
            "//evil.example/x",
            "/x?u=https://evil.example",
            "/repos/../admin",
            "/a/%2e%2e/b",
            "/a b",
            "/a\nb",
            "/a\\b",
        ] {
            assert!(validate_api_path(bad).is_err(), "{bad:?}");
        }
    }
}
