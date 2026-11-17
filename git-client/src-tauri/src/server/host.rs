//! Hôte du serveur : ce que Tauri fournit sur le bureau (dossiers, événements, flux, fenêtre appelante).
//!
//! Chaque onglet du navigateur est une « fenêtre », identifiée par un libellé choisi par l'interface. Son
//! WebSocket (voir `http.rs`) porte les événements diffusés et les flux (`Channel`) ouverts par ses commandes.

use std::collections::HashMap;
use std::marker::PhantomData;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tokio::sync::mpsc::UnboundedSender;
use crate::host::HostExt;
use super::config::Config;

pub use tokio::task::spawn_blocking;

/// Onglet connecté : l'utilisateur qui l'a ouvert, et la file des messages à lui envoyer.
#[derive(Clone)]
struct Session {
    user: Option<Arc<str>>,
    out: UnboundedSender<String>,
}

struct Shared {
    config: Arc<Config>,
    sessions: Mutex<HashMap<String, Session>>,
}

/// Contexte d'une commande. Cloné à chaque appel ; `for_user` le restreint à un utilisateur du NAS.
#[derive(Clone)]
pub struct Host {
    shared: Arc<Shared>,
    user: Option<Arc<str>>,
}

impl Host {
    pub fn new(config: Arc<Config>) -> Host {
        let shared = Shared { config, sessions: Mutex::new(HashMap::new()) };
        Host { shared: Arc::new(shared), user: None }
    }

    /// Réglages du serveur.
    pub fn config(&self) -> &Config {
        &self.shared.config
    }

    /// Même serveur, vu par un utilisateur : ses comptes et réglages sont dans un dossier à lui.
    pub fn for_user(&self, user: Option<&str>) -> Host {
        Host { shared: self.shared.clone(), user: user.map(Arc::from) }
    }

    pub fn user(&self) -> Option<&str> {
        self.user.as_deref()
    }

    /// Enregistre le WebSocket d'un onglet (le précédent du même libellé est remplacé).
    pub fn register(&self, label: &str, out: UnboundedSender<String>) {
        let session = Session { user: self.user.clone(), out };
        self.shared.sessions.lock().unwrap().insert(label.to_string(), session);
    }

    /// Retire l'onglet, sauf s'il s'est déjà reconnecté avec un autre WebSocket.
    pub fn unregister(&self, label: &str, out: &UnboundedSender<String>) -> bool {
        let mut sessions = self.shared.sessions.lock().unwrap();
        if sessions.get(label).is_some_and(|s| s.out.same_channel(out)) {
            sessions.remove(label);
            true
        } else {
            false
        }
    }

    /// Flux vers l'onglet `label`, identifié par `id` (choisi par l'interface).
    pub fn channel<T>(&self, label: &str, id: u32) -> Result<Channel<T>, String> {
        let session = self.shared.sessions.lock().unwrap().get(label).cloned();
        let out = session
            .filter(|s| s.user == self.user)
            .map(|s| s.out)
            .ok_or_else(|| tr!("l'onglet n'est pas connecté au serveur", "the tab is not connected to the server"))?;
        Ok(Channel::new(move |data| out.send(envelope("channel", &id.to_string(), &data)).is_ok()))
    }

    /// Dossier d'un utilisateur : `<dossier>/users/<identifiant>`, sans caractère qui permette d'en sortir.
    fn scoped(&self, base: &std::path::Path) -> PathBuf {
        match &self.user {
            Some(user) => {
                let safe: String = user.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
                base.join("users").join(safe.trim_start_matches('.'))
            }
            None => base.to_path_buf(),
        }
    }
}

/// Message du WebSocket : `{"t":"channel","id":3,"data":…}` ou `{"t":"event","id":"debug-log","data":…}`.
fn envelope(kind: &str, id: &str, data: &str) -> String {
    let id = if kind == "channel" { id.to_string() } else { serde_json::Value::String(id.to_string()).to_string() };
    format!("{{\"t\":\"{kind}\",\"id\":{id},\"data\":{data}}}")
}

impl HostExt for Host {
    fn config_dir(&self) -> Result<PathBuf, String> {
        Ok(self.scoped(&self.shared.config.config_dir))
    }

    fn data_dir(&self) -> Result<PathBuf, String> {
        Ok(self.scoped(&self.shared.config.data_dir))
    }

    fn emit_event<S: Serialize + Clone>(&self, event: &str, payload: S) {
        let Ok(data) = serde_json::to_string(&payload) else { return };
        let message = envelope("event", event, &data);
        for session in self.shared.sessions.lock().unwrap().values().filter(|s| s.user == self.user) {
            let _ = session.out.send(message.clone());
        }
    }
}

/// Onglet appelant.
#[derive(Clone, Debug)]
pub struct Window {
    label: String,
}

impl Window {
    pub fn new(label: &str) -> Window {
        Window { label: label.to_string() }
    }

    pub fn label(&self) -> &str {
        &self.label
    }
}

/// Flux de messages vers l'interface : chaque `send` est un message JSON.
pub struct Channel<T> {
    sink: Arc<dyn Fn(String) -> bool + Send + Sync>,
    _marker: PhantomData<fn(T)>,
}

impl<T> Clone for Channel<T> {
    fn clone(&self) -> Self {
        Channel { sink: self.sink.clone(), _marker: PhantomData }
    }
}

impl<T> Channel<T> {
    /// `sink` reçoit le JSON de chaque message et rend `false` quand plus personne ne l'écoute.
    pub fn new(sink: impl Fn(String) -> bool + Send + Sync + 'static) -> Channel<T> {
        Channel { sink: Arc::new(sink), _marker: PhantomData }
    }
}

impl<T: Serialize> Channel<T> {
    pub fn send(&self, data: T) -> Result<(), String> {
        let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
        if (self.sink)(json) {
            Ok(())
        } else {
            Err(tr!("l'onglet est fermé", "the tab is closed"))
        }
    }
}

/// Flux de test et ce qu'il a reçu (JSON), sans navigateur.
#[cfg(test)]
pub fn test_channel<T: Serialize>() -> (Channel<T>, std::sync::mpsc::Receiver<String>) {
    let (tx, rx) = std::sync::mpsc::channel();
    (Channel::new(move |json| tx.send(json).is_ok()), rx)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host() -> Host {
        let mut config = Config::local("/data".into(), "/web".into());
        config.config_dir = "/cfg".into();
        Host::new(Arc::new(config))
    }

    #[test]
    fn directories_are_per_user() {
        let host = host();
        assert_eq!(host.config_dir().unwrap(), PathBuf::from("/cfg"));
        let alice = host.for_user(Some("alice"));
        assert_eq!(alice.config_dir().unwrap(), PathBuf::from("/cfg/users/alice"));
        assert_eq!(alice.data_dir().unwrap(), PathBuf::from("/data/users/alice"));
    }

    #[test]
    fn user_names_cannot_leave_their_directory() {
        let host = host().for_user(Some("../../etc/passwd"));
        let dir = host.config_dir().unwrap();
        assert!(dir.starts_with("/cfg/users"), "{dir:?}");
        assert!(!dir.components().any(|c| c.as_os_str() == ".."), "{dir:?}");
    }

    #[tokio::test]
    async fn events_and_channels_reach_only_the_tabs_of_the_same_user() {
        let host = host();
        let (alice_tx, mut alice_rx) = tokio::sync::mpsc::unbounded_channel();
        let (bob_tx, mut bob_rx) = tokio::sync::mpsc::unbounded_channel();
        host.for_user(Some("alice")).register("tab-a", alice_tx);
        host.for_user(Some("bob")).register("tab-b", bob_tx);

        host.for_user(Some("alice")).emit_event("debug-log", serde_json::json!({"message": "x"}));
        assert_eq!(alice_rx.recv().await.unwrap(), r#"{"t":"event","id":"debug-log","data":{"message":"x"}}"#);
        assert!(bob_rx.try_recv().is_err());

        let channel = host.for_user(Some("alice")).channel::<u32>("tab-a", 7).unwrap();
        channel.send(42).unwrap();
        assert_eq!(alice_rx.recv().await.unwrap(), r#"{"t":"channel","id":7,"data":42}"#);
        // Un autre utilisateur ne peut pas ouvrir un flux vers cet onglet.
        assert!(host.for_user(Some("bob")).channel::<u32>("tab-a", 1).is_err());
        assert!(host.channel::<u32>("absent", 1).is_err());
    }

    #[test]
    fn a_reconnected_tab_is_not_removed_by_its_old_socket() {
        let host = host();
        let (old, _old_rx) = tokio::sync::mpsc::unbounded_channel();
        let (new, _new_rx) = tokio::sync::mpsc::unbounded_channel();
        host.register("tab", old.clone());
        host.register("tab", new.clone());
        assert!(!host.unregister("tab", &old));
        assert!(host.channel::<u32>("tab", 1).is_ok());
        assert!(host.unregister("tab", &new));
    }

    #[test]
    fn closed_channel_reports_an_error() {
        let (channel, rx) = test_channel::<u32>();
        channel.send(1).unwrap();
        assert_eq!(rx.recv().unwrap(), "1");
        drop(rx);
        assert!(channel.send(2).is_err());
    }
}
