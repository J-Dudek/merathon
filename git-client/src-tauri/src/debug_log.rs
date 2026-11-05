//! Logs du mode débug (Préférences > À propos), envoyés à l'onglet « Logs » du panneau du bas.
//! Ils décrivent les étapes qui peuvent bloquer (réseau, authentification, LFS) en temps réel.
//! Ne jamais y mettre de secret : les messages finissent dans les rapports de bug.

use std::fmt::Display;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Instant;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static ENABLED: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Clone, Serialize)]
struct Entry {
    level: &'static str,
    message: String,
}

fn emit(level: &'static str, message: String) {
    if let Some(app) = APP.get() {
        let _ = app.emit("debug-log", Entry { level, message });
    }
}

/// Le message n'est construit que si le mode débug est actif.
pub fn debug(message: impl FnOnce() -> String) {
    if ENABLED.load(Ordering::Relaxed) {
        emit("debug", message());
    }
}

/// Journalise le début d'une étape, puis sa durée et son résultat : une étape sans fin est une étape bloquée.
pub fn timed<T, E: Display>(step: impl Display, f: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
    if !ENABLED.load(Ordering::Relaxed) {
        return f();
    }
    emit("debug", format!("{step}: start"));
    let started = Instant::now();
    let result = f();
    let elapsed = started.elapsed().as_millis();
    match &result {
        Ok(_) => emit("debug", format!("{step}: done in {elapsed} ms")),
        Err(e) => emit("error", format!("{step}: failed after {elapsed} ms: {e}")),
    }
    result
}

#[tauri::command]
pub fn set_debug_logging(app: AppHandle, enabled: bool) {
    APP.get_or_init(|| app);
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_built_while_disabled() {
        debug(|| panic!("message construit alors que le mode débug est inactif"));
        assert_eq!(timed("step", || Ok::<_, String>(1)), Ok(1));
        assert_eq!(timed("step", || Err::<i32, _>("échec".to_string())), Err("échec".to_string()));
    }
}
