//! Commandes qui n'existent que sur le serveur.

use serde::Serialize;
use crate::host::{command, Host};

#[derive(Serialize)]
pub struct ServerInfo {
    version: &'static str,
    /// Utilisateur connecté (identifiant DSM), absent sans authentification.
    user: Option<String>,
    /// Le terminal intégré est-il autorisé par l'administrateur ?
    terminal: bool,
    /// Dossiers où les dépôts peuvent être ouverts.
    roots: Vec<String>,
    /// Mode d'authentification (`none`, `token` ou `dsm`).
    auth: &'static str,
}

/// Ce que l'interface doit savoir du serveur : version, utilisateur, fonctions autorisées.
#[command]
pub fn server_info(app: Host) -> ServerInfo {
    let config = app.config();
    ServerInfo {
        version: env!("CARGO_PKG_VERSION"),
        user: app.user().map(str::to_string),
        terminal: config.terminal,
        roots: config.allowed_roots.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        auth: config.auth.name(),
    }
}
