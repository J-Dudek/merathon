//! Table des commandes du serveur : chaque `#[command]` s'y inscrit (macro `merathon-macros`), le serveur HTTP
//! retrouve la commande par son nom et l'appelle avec les arguments JSON de la requête.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};
use super::host::{Host, Window};

/// Résultat d'une commande : sa valeur, ou l'erreur que l'interface recevrait de Tauri (JSON).
pub type CommandResult = Result<Value, Value>;

pub struct CommandEntry {
    pub name: &'static str,
    pub handler: fn(Invocation) -> Pin<Box<dyn Future<Output = CommandResult> + Send>>,
}

inventory::collect!(CommandEntry);

/// Commande par son nom.
pub fn find(name: &str) -> Option<&'static CommandEntry> {
    static TABLE: OnceLock<HashMap<&'static str, &'static CommandEntry>> = OnceLock::new();
    TABLE.get_or_init(|| inventory::iter::<CommandEntry>().map(|e| (e.name, e)).collect()).get(name).copied()
}

/// Noms de toutes les commandes inscrites.
pub fn names() -> Vec<&'static str> {
    let mut names: Vec<_> = inventory::iter::<CommandEntry>().map(|e| e.name).collect();
    names.sort_unstable();
    names
}

/// Un appel : le contexte, l'onglet appelant et les arguments (clés en camelCase, comme l'IPC de Tauri).
pub struct Invocation {
    host: Host,
    window: Window,
    args: Map<String, Value>,
}

impl Invocation {
    pub fn new(host: Host, window: Window, args: Map<String, Value>) -> Invocation {
        Invocation { host, window, args }
    }

    pub fn host(&self) -> Host {
        self.host.clone()
    }

    pub fn window(&self) -> Window {
        self.window.clone()
    }

    /// Argument `key` ; absent, il vaut `null` (donc `None` pour un `Option`).
    pub fn arg<T: DeserializeOwned>(&mut self, key: &str) -> Result<T, Value> {
        let value = self.args.remove(key).unwrap_or(Value::Null);
        serde_json::from_value(value).map_err(|e| {
            Value::String(tr!("argument « {key} » invalide : {e}", "invalid argument \"{key}\": {e}"))
        })
    }

    /// Flux vers l'onglet appelant : l'interface en a choisi le numéro et l'a passé en argument.
    pub fn channel<T>(&mut self, key: &str) -> Result<super::host::Channel<T>, Value> {
        let id: u32 = self.arg(key)?;
        self.host.channel(self.window.label(), id).map_err(Value::String)
    }
}

pub fn to_json<T: Serialize>(value: &T) -> CommandResult {
    serde_json::to_value(value).map_err(|e| Value::String(e.to_string()))
}
