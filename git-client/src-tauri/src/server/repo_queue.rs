//! Opérations réseau d'un même dépôt, l'une après l'autre.
//!
//! Sur le NAS, plusieurs navigateurs (personnes, onglets) ouvrent les mêmes dépôts, et chaque page lance sa propre
//! synchronisation automatique. Deux fetch simultanés d'un dépôt se disputent les verrous de ses références : mesuré,
//! 12 fetch automatiques sur 20 échouaient (« failed to lock file … refs/remotes… ») avec quatre pages synchronisées en
//! même temps. Un pull ou un push lancé à la main pendant le fetch automatique d'une autre page échouait de la même façon.
//!
//! Les commandes réseau d'un dépôt attendent donc leur tour, et un fetch automatique qui suit de près un fetch complet du
//! même dépôt (par n'importe quelle page) n'est pas refait : sans changement côté serveur distant, il n'apporterait rien.
//! Le bureau n'est pas concerné : une seule personne, et ce module ne fait partie que du serveur.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use serde_json::{Map, Value};
use super::dispatch::CommandResult;

/// Commandes qui échangent avec un serveur distant et écrivent les références du dépôt (`path`).
const NETWORK_COMMANDS: &[&str] = &[
    "fetch_remote",
    "pull",
    "pull_fast_forward",
    "push",
    "push_tag",
    "delete_remote_branch",
    "delete_remote_tag",
    "force_push_pull_request",
    "update_submodules",
    "lfs_pull",
];

/// Un fetch automatique plus proche que cela du dernier fetch complet du dépôt n'est pas refait. Plus court que le plus
/// petit intervalle de synchronisation proposé (une minute) : chaque page garde sa propre fréquence.
pub const FRESH_FETCH: Duration = Duration::from_secs(45);

#[derive(Default)]
struct RepoState {
    last_full_fetch: Option<Instant>,
}

static REPOS: LazyLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<RepoState>>>>> = LazyLock::new(Default::default);

/// Ce que l'appel demande, lu avant que ses arguments ne soient passés à la commande.
pub struct Plan {
    repo: PathBuf,
    /// Fetch de tous les remotes (`remote` absent).
    full_fetch: bool,
    /// Fetch de la synchronisation automatique (`background`), qu'un fetch récent rend inutile.
    automatic: bool,
}

/// `None` : commande sans échange réseau sur un dépôt, exécutée sans attendre.
pub fn plan(command: &str, args: &Map<String, Value>) -> Option<Plan> {
    if !NETWORK_COMMANDS.contains(&command) {
        return None;
    }
    let path = args.get("path")?.as_str()?;
    // Même dépôt sous deux écritures (`/volume1/git/x` et `/volume1/git/x/`, lien symbolique) : une seule file.
    let repo = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let full_fetch = command == "fetch_remote" && args.get("remote").is_none_or(Value::is_null);
    let automatic = full_fetch && args.get("background").and_then(Value::as_bool) == Some(true);
    Some(Plan { repo, full_fetch, automatic })
}

/// Exécute `call` à son tour dans la file du dépôt ; un fetch automatique rendu inutile par un fetch récent renvoie
/// tout de suite `null`, comme un fetch réussi (la commande ne renvoie rien).
pub async fn run<F: Future<Output = CommandResult>>(plan: Option<Plan>, call: F) -> CommandResult {
    let Some(plan) = plan else {
        return call.await;
    };
    let queue = REPOS.lock().unwrap_or_else(|e| e.into_inner()).entry(plan.repo).or_default().clone();
    let mut state = queue.lock().await;
    if plan.automatic && state.last_full_fetch.is_some_and(|at| at.elapsed() < FRESH_FETCH) {
        return Ok(Value::Null);
    }
    let result = call.await;
    if plan.full_fetch && result.is_ok() {
        state.last_full_fetch = Some(Instant::now());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn args(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn only_network_commands_on_a_repository_are_queued() {
        assert!(plan("get_status", &args(json!({ "path": "/x" }))).is_none());
        assert!(plan("fetch_remote", &args(json!({}))).is_none());
        let p = plan("fetch_remote", &args(json!({ "path": "/x", "remote": null, "background": true }))).unwrap();
        assert!(p.full_fetch && p.automatic);
        let p = plan("fetch_remote", &args(json!({ "path": "/x", "remote": "origin", "background": true }))).unwrap();
        assert!(!p.full_fetch && !p.automatic);
        let p = plan("fetch_remote", &args(json!({ "path": "/x" }))).unwrap();
        assert!(p.full_fetch && !p.automatic, "fetch lancé à la main : jamais sauté");
        assert!(plan("push", &args(json!({ "path": "/x" }))).is_some());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn calls_on_the_same_repository_never_overlap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        let running = Arc::new(AtomicUsize::new(0));
        let overlap = Arc::new(AtomicUsize::new(0));
        let tasks: Vec<_> = (0..6)
            .map(|_| {
                let (path, running, overlap) = (path.clone(), running.clone(), overlap.clone());
                tokio::spawn(async move {
                    run(plan("push", &args(json!({ "path": path }))), async move {
                        if running.fetch_add(1, Ordering::SeqCst) > 0 {
                            overlap.fetch_add(1, Ordering::SeqCst);
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        running.fetch_sub(1, Ordering::SeqCst);
                        Ok(Value::Null)
                    })
                    .await
                })
            })
            .collect();
        for task in tasks {
            task.await.unwrap().unwrap();
        }
        assert_eq!(overlap.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_recent_full_fetch_makes_the_automatic_one_useless_but_not_a_manual_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        let fetches = Arc::new(AtomicUsize::new(0));
        let fetch = |background: bool| {
            let fetches = fetches.clone();
            run(plan("fetch_remote", &args(json!({ "path": path, "remote": null, "background": background }))), async move {
                fetches.fetch_add(1, Ordering::SeqCst);
                Ok(Value::Null)
            })
        };
        fetch(true).await.unwrap();
        fetch(true).await.unwrap();
        assert_eq!(fetches.load(Ordering::SeqCst), 1, "deuxième fetch automatique sauté");
        fetch(false).await.unwrap();
        assert_eq!(fetches.load(Ordering::SeqCst), 2, "fetch demandé à la main : toujours fait");
    }

    #[tokio::test]
    async fn a_failed_fetch_does_not_count_as_recent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        let automatic = || plan("fetch_remote", &args(json!({ "path": path, "remote": null, "background": true })));
        run(automatic(), async { Err(Value::String("hors ligne".into())) }).await.unwrap_err();
        let fetches = Arc::new(AtomicUsize::new(0));
        let counter = fetches.clone();
        run(automatic(), async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(Value::Null)
        })
        .await
        .unwrap();
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }
}
