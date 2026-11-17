//! Routes HTTP : les commandes (`POST api/invoke/<nom>`), le WebSocket des événements et des flux, et l'interface.
//!
//! Toutes les URL de l'interface sont relatives : le service peut être servi à la racine ou derrière un
//! reverse proxy (`/merathon/`, voir `Config::base_path`).

use std::sync::Arc;
use std::time::Duration;
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Map, Value};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use super::auth::{same_origin, Access, Authenticator, LoginRefused};
use super::config::Config;
use super::dispatch::{self, Invocation};
use super::repo_queue;
use super::host::{Host, Window};
use super::paths;

/// Intervalle des messages de maintien : un reverse proxy coupe une connexion silencieuse (60 s par défaut).
const KEEPALIVE: Duration = Duration::from_secs(25);
/// Taille maximale d'une requête de commande (un fichier édité dans l'interface en fait partie).
const MAX_BODY: usize = 64 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub host: Host,
    pub config: Arc<Config>,
    pub auth: Arc<Authenticator>,
}

/// Libellé d'onglet : choisi par l'interface, il sert de clé et de nom de fichier, donc sobrement limité.
pub fn valid_label(label: &str) -> bool {
    !label.is_empty() && label.len() <= 64 && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn router(state: AppState) -> Router {
    let index = state.config.web_dir.join("index.html");
    let web = ServeDir::new(&state.config.web_dir).fallback(ServeFile::new(index));
    let app = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/session", get(session_status))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/invoke/{cmd}", post(invoke).layer(axum::extract::DefaultBodyLimit::max(MAX_BODY)))
        .route("/api/ws", get(websocket))
        .fallback_service(web)
        .with_state(state.clone())
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("same-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY, content_security_policy(&state.config)));
    if state.config.base_path.is_empty() {
        app
    } else {
        // `/merathon` → `/merathon/` : les URL relatives de la page en dépendent.
        let base = state.config.base_path.clone();
        let redirect_to = format!("{base}/");
        Router::new().nest_service(&base, app).layer(axum::middleware::from_fn(move |request: axum::extract::Request, next: axum::middleware::Next| {
            let redirect_to = redirect_to.clone();
            let bare = request.uri().path() == redirect_to.trim_end_matches('/');
            async move {
                if bare { Redirect::permanent(&redirect_to).into_response() } else { next.run(request).await }
            }
        }))
    }
}

/// Politique de sécurité du contenu : tout vient du service lui-même, sauf les images (avatars des forges), et seuls
/// les cadres de `frame_ancestors` (DSM) peuvent afficher la page.
fn content_security_policy(config: &Config) -> HeaderValue {
    let policy = format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; \
         font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; \
         form-action 'self'; frame-ancestors {}",
        config.frame_ancestors
    );
    HeaderValue::from_str(&policy).unwrap_or_else(|_| HeaderValue::from_static("default-src 'self'"))
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(Value::String(message.to_string()))).into_response()
}

/// Vérifie l'origine et l'identité de la requête ; renvoie l'hôte de son utilisateur, ou la réponse de refus.
/// La réponse de refus est dans un `Box` : `Response` pèse plus de 128 octets, et `Result` le recopierait à chaque appel.
async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<Host, Box<Response>> {
    if !same_origin(headers) {
        return Err(Box::new(error(StatusCode::FORBIDDEN, &tr!("origine refusée", "origin refused"))));
    }
    match state.auth.check(headers).await {
        Access::Granted(user) => Ok(state.host.for_user(user.as_deref())),
        Access::Unauthenticated => Err(Box::new(error(StatusCode::UNAUTHORIZED, &tr!("connexion requise", "sign-in required")))),
        Access::Forbidden(user) => {
            Err(Box::new(error(StatusCode::FORBIDDEN, &tr!("{user} n'est pas autorisé à utiliser Merathon", "{user} is not allowed to use Merathon"))))
        }
    }
}

/// Avancement de la connexion, lisible sans être connecté : l'interface décide d'afficher ou non la page de connexion.
async fn session_status(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let (authenticated, user, forbidden) = match state.auth.check(&headers).await {
        Access::Granted(user) => (true, user, false),
        Access::Unauthenticated => (false, None, false),
        Access::Forbidden(user) => (false, Some(user), true),
    };
    Json(serde_json::json!({ "auth": state.auth.mode().name(), "authenticated": authenticated, "user": user, "forbidden": forbidden }))
}

#[derive(Deserialize)]
struct LoginBody {
    token: String,
}

async fn login(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<LoginBody>) -> Response {
    if !same_origin(&headers) {
        return error(StatusCode::FORBIDDEN, &tr!("origine refusée", "origin refused"));
    }
    let secure = headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()) == Some("https");
    match state.auth.login(&body.token, secure, &state.config.base_path).await {
        Ok(cookie) => (StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response(),
        Err(LoginRefused) => error(StatusCode::UNAUTHORIZED, &tr!("jeton incorrect", "wrong token")),
    }
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !same_origin(&headers) {
        return error(StatusCode::FORBIDDEN, &tr!("origine refusée", "origin refused"));
    }
    let cookie = state.auth.logout(&headers, &state.config.base_path);
    (StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response()
}

async fn invoke(State(state): State<AppState>, Path(cmd): Path<String>, headers: HeaderMap, body: Bytes) -> Response {
    let host = match authorize(&state, &headers).await {
        Ok(host) => host,
        Err(refusal) => return *refusal,
    };
    let Some(entry) = dispatch::find(&cmd) else {
        return error(StatusCode::NOT_FOUND, &tr!("commande inconnue : {cmd}", "unknown command: {cmd}"));
    };
    let args = if body.is_empty() {
        Map::new()
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(Value::Object(map)) => map,
            _ => return error(StatusCode::BAD_REQUEST, &tr!("les arguments doivent être un objet JSON", "arguments must be a JSON object")),
        }
    };
    let label = headers.get("x-merathon-window").and_then(|v| v.to_str().ok()).unwrap_or("main");
    if !valid_label(label) {
        return error(StatusCode::BAD_REQUEST, "invalid window label");
    }
    if cmd.starts_with("terminal_") && !state.config.terminal {
        return error(StatusCode::FORBIDDEN, &tr!("le terminal est désactivé sur ce serveur", "the terminal is disabled on this server"));
    }
    if let Err(message) = paths::check_arguments(&cmd, &args, &state.config.allowed_roots) {
        return error(StatusCode::FORBIDDEN, &message);
    }
    // Opérations réseau d'un même dépôt l'une après l'autre (plusieurs pages synchronisent les mêmes dépôts).
    let queue = repo_queue::plan(&cmd, &args);
    let invocation = Invocation::new(host, Window::new(label), args);
    match repo_queue::run(queue, (entry.handler)(invocation)).await {
        Ok(value) => Json(value).into_response(),
        // Même erreur que celle que Tauri renvoie à l'interface : c'est l'interface qui la met en forme.
        Err(value) => (StatusCode::BAD_REQUEST, Json(value)).into_response(),
    }
}

#[derive(Deserialize)]
struct WsQuery {
    window: String,
}

async fn websocket(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<WsQuery>, ws: WebSocketUpgrade) -> Response {
    let host = match authorize(&state, &headers).await {
        Ok(host) => host,
        Err(refusal) => return *refusal,
    };
    if !valid_label(&query.window) {
        return error(StatusCode::BAD_REQUEST, "invalid window label");
    }
    ws.on_upgrade(move |socket| session(socket, host, query.window))
}

/// Un onglet connecté : ses messages (événements, flux) sortent d'une file, et la fermeture libère ses ressources.
async fn session(socket: WebSocket, host: Host, label: String) {
    let (mut sink, mut incoming) = socket.split();
    let (out, mut queue) = tokio::sync::mpsc::unbounded_channel::<String>();
    host.register(&label, out.clone());

    let writer = tokio::spawn(async move {
        let mut tick = tokio::time::interval(KEEPALIVE);
        loop {
            let message = tokio::select! {
                queued = queue.recv() => match queued {
                    Some(text) => Message::Text(text.into()),
                    None => break,
                },
                _ = tick.tick() => Message::Text(r#"{"t":"ping"}"#.into()),
            };
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = incoming.next().await {
        if matches!(message, Message::Close(_)) {
            break;
        }
    }
    writer.abort();
    // Un onglet déjà reconnecté garde ses terminaux et sa surveillance.
    if host.unregister(&label, &out) {
        crate::workdir_watch::watchers().close_window(&label);
        crate::terminal::terminals().close_window(&label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_labels_are_restricted() {
        assert!(valid_label("main"));
        assert!(valid_label("tab-3_a"));
        assert!(!valid_label(""));
        assert!(!valid_label("../etc"));
        assert!(!valid_label("a b"));
        assert!(!valid_label(&"x".repeat(65)));
    }
}
