//! Merathon sur un NAS : le même cœur que l'application de bureau, sans fenêtre.
//!
//! Le binaire `merathon-server` sert l'interface (le dossier `dist/` construit par `vite build --mode server`)
//! et expose les commandes en HTTP ; les événements et les flux (terminal, surveillance du dossier de travail)
//! passent par un WebSocket. Voir docs/nas.fr.md.

pub mod auth;
pub mod commands;
pub mod config;
pub mod dispatch;
pub mod host;
pub mod http;
pub mod paths;
pub mod repo_queue;

use std::sync::Arc;
use config::Config;

/// Prépare le processus avant de démarrer le moteur asynchrone (aucun autre fil ne lit alors l'environnement).
pub fn prepare_environment(config: &Config) -> Result<(), String> {
    for dir in [&config.data_dir, &config.config_dir] {
        std::fs::create_dir_all(dir).map_err(|e| format!("{} : {e}", dir.display()))?;
    }
    // Git lit sa configuration globale, ses clés SSH et `known_hosts` dans HOME : le service n'a pas de compte
    // utilisable, il les garde dans son dossier de données.
    if std::env::var_os("MERATHON_KEEP_HOME").is_none() {
        std::env::set_var("HOME", &config.data_dir);
    }
    if let Err(e) = crate::git::configure_network_timeouts() {
        eprintln!("Délais réseau de libgit2 non appliqués : {e}");
    }
    Ok(())
}

/// Sert jusqu'à l'arrêt demandé (SIGTERM, Ctrl-C).
pub async fn run(config: Config) -> Result<(), String> {
    let config = Arc::new(config);
    let host = host::Host::new(config.clone());
    let auth = Arc::new(auth::Authenticator::new(&config));
    let state = http::AppState { host, config: config.clone(), auth };
    let listener = tokio::net::TcpListener::bind(config.bind).await.map_err(|e| format!("{} : {e}", config.bind))?;
    eprintln!(
        "Merathon écoute sur http://{}{}/ ({} commandes, authentification : {})",
        config.bind,
        config.base_path,
        dispatch::names().len(),
        config.auth.name()
    );
    axum::serve(listener, http::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| e.to_string())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = term.recv() => {}
                    _ = tokio::signal::ctrl_c() => {}
                }
            }
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
    eprintln!("Arrêt demandé");
}
