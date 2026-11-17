//! Pont entre la logique de l'application et son hôte.
//!
//! Merathon existe en deux déclinaisons, exclusives (voir `Cargo.toml`) :
//! - `tauri-app` : application de bureau et Android, dont l'hôte est Tauri ;
//! - `server` : service du NAS Synology, dont l'hôte est le serveur HTTP de `crate::server`.
//!
//! Le code partagé (commandes, comptes, terminal, surveillance…) ne nomme jamais Tauri : il passe par
//! les types de ce module (`Host`, `Window`, `Channel`) et par `HostExt`.

use std::path::PathBuf;
use serde::Serialize;

#[cfg(all(feature = "tauri-app", feature = "server"))]
compile_error!("les fonctionnalités `tauri-app` et `server` s'excluent : compiler avec --no-default-features --features server");

/// Déclare une commande de l'interface (Tauri) et, pour le serveur, sa route.
pub use merathon_macros::command;

#[cfg(feature = "tauri-app")]
mod imp {
    /// Contexte de l'application, fourni à chaque commande qui en a besoin.
    pub use tauri::AppHandle as Host;
    /// Fenêtre appelante.
    pub use tauri::Window;
    /// Flux de messages vers l'interface (terminal, surveillance du dossier de travail).
    pub use tauri::ipc::Channel;
    pub use tauri::async_runtime::spawn_blocking;

    use super::HostExt;
    use serde::Serialize;
    use std::path::PathBuf;
    use tauri::{Emitter, Manager};

    impl HostExt for Host {
        fn config_dir(&self) -> Result<PathBuf, String> {
            self.path().app_config_dir().map_err(|e| e.to_string())
        }

        fn data_dir(&self) -> Result<PathBuf, String> {
            self.path().app_data_dir().map_err(|e| e.to_string())
        }

        fn emit_event<S: Serialize + Clone>(&self, event: &str, payload: S) {
            let _ = self.emit(event, payload);
        }
    }

    /// Flux de test et ce qu'il a reçu (JSON), sans fenêtre.
    #[cfg(test)]
    pub fn test_channel<T: Serialize>() -> (Channel<T>, std::sync::mpsc::Receiver<String>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |body| {
            match body {
                tauri::ipc::InvokeResponseBody::Json(json) => {
                    let _ = tx.send(json);
                }
                other => panic!("réponse inattendue : {other:?}"),
            }
            Ok(())
        });
        (channel, rx)
    }
}

#[cfg(feature = "server")]
mod imp {
    pub use crate::server::host::{spawn_blocking, Channel, Host, Window};
    #[cfg(test)]
    pub use crate::server::host::test_channel;
}

pub use imp::*;

/// Ce que la logique partagée demande à son hôte.
pub trait HostExt {
    /// Dossier de configuration (comptes, réglages de la surveillance des PR).
    fn config_dir(&self) -> Result<PathBuf, String>;
    /// Dossier des données (dépôts de l'appareil sur mobile).
    fn data_dir(&self) -> Result<PathBuf, String>;
    /// Événement diffusé à toutes les fenêtres (ou onglets) ouvertes.
    fn emit_event<S: Serialize + Clone>(&self, event: &str, payload: S);
}
