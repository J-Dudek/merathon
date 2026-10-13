//! Commandes exposées au frontend.
//!
//! Les opérations locales sont synchrones (rapides). Les opérations réseau (clone, fetch,
//! pull, push) sont `async` et s'exécutent dans un thread dédié pour ne pas figer l'UI.

use git2::Repository;
use tauri::{AppHandle, Manager};
use crate::accounts::{Account, AccountStore, AuthKind, Provider, SavedAccount};
use crate::oauth;
use crate::git::{self, GitError};

fn with_repo<T>(path: &str, f: impl FnOnce(&Repository) -> Result<T, GitError>) -> Result<T, GitError> {
    let repo = git::open_repo(path)?;
    f(&repo)
}

/// Comme `with_repo`, pour les opérations qui réécrivent la copie de travail : les fichiers
/// LFS écrits par libgit2 sont des pointeurs, `git lfs checkout` remet leur contenu.
fn with_repo_lfs<T>(path: &str, f: impl FnOnce(&Repository) -> Result<T, GitError>) -> Result<T, GitError> {
    let repo = git::open_repo(path)?;
    let result = f(&repo)?;
    let _ = git::lfs::lfs_checkout(&repo);
    Ok(result)
}

fn remote_url(repo: &Repository, name: &str) -> String {
    repo.find_remote(name).ok().and_then(|r| r.url().ok().map(str::to_string)).unwrap_or_default()
}

fn with_repo_mut<T>(path: &str, f: impl FnOnce(&mut Repository) -> Result<T, GitError>) -> Result<T, GitError> {
    let mut repo = git::open_repo(path)?;
    f(&mut repo)
}

fn account_store(app: &AppHandle) -> Result<AccountStore, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(AccountStore::new(dir))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, GitError> + Send + 'static,
) -> Result<T, GitError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| GitError::Other(e.to_string()))?
}

/// Exécute une opération réseau avec les identifiants des comptes enregistrés.
async fn network<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&dyn Fn(&str) -> Option<git::Credentials>) -> Result<T, GitError> + Send + 'static,
) -> Result<T, GitError> {
    let store = account_store(app).map_err(GitError::Other)?;
    blocking(move || f(&|url: &str| store.credentials_for(url))).await
}

// ---------------------------------------------------------------- Dépôt

#[tauri::command]
pub fn open_repository(path: String) -> Result<git::RepoInfo, GitError> {
    with_repo(&path, git::repo_info)
}

#[tauri::command]
pub fn get_repo_info(path: String) -> Result<git::RepoInfo, GitError> {
    with_repo(&path, git::repo_info)
}

#[tauri::command]
pub fn init_repository(path: String) -> Result<(), GitError> {
    git::init_repo(&path)
}

#[tauri::command]
pub fn get_identity(path: Option<String>) -> Result<git::Identity, GitError> {
    match path {
        Some(p) => with_repo(&p, git::get_identity),
        None => {
            let config = git2::Config::open_default()?.snapshot()?;
            Ok(git::Identity {
                name: config.get_string("user.name").ok(),
                email: config.get_string("user.email").ok(),
            })
        }
    }
}

/// `path` absent : configuration globale de l'utilisateur.
#[tauri::command]
pub fn set_identity(path: Option<String>, name: String, email: String) -> Result<(), GitError> {
    match path {
        Some(p) => with_repo(&p, |r| git::set_identity(Some(r), &name, &email)),
        None => git::set_identity(None, &name, &email),
    }
}

/// Ouvre une nouvelle fenêtre, éventuellement directement sur le dépôt `repo`.
#[tauri::command]
pub fn open_new_window(app: AppHandle, repo: Option<String>) -> Result<(), String> {
    crate::window::open_new_window(&app, repo.as_deref())
}

// ---------------------------------------------------------------- Historique

#[tauri::command]
pub fn get_commits(path: String, limit: usize) -> Result<Vec<git::CommitInfo>, GitError> {
    with_repo(&path, |r| git::get_commits(r, limit))
}

#[tauri::command]
pub fn get_branches(path: String) -> Result<Vec<git::BranchInfo>, GitError> {
    with_repo(&path, git::get_branches)
}

#[tauri::command]
pub fn get_tags(path: String) -> Result<Vec<git::TagInfo>, GitError> {
    with_repo(&path, git::get_tags)
}

#[tauri::command]
pub fn get_commit_details(path: String, hash: String) -> Result<git::CommitDetails, GitError> {
    with_repo(&path, |r| git::get_commit_details(r, &hash))
}

#[tauri::command]
pub fn get_commit_file_diff(path: String, hash: String, file_path: String) -> Result<git::FileDiff, GitError> {
    with_repo(&path, |r| git::get_commit_file_diff(r, &hash, &file_path))
}

/// Fichiers modifiés par `head` depuis son ancêtre commun avec `base` (diff d'une pull request).
#[tauri::command]
pub fn compare_refs(path: String, base: String, head: String) -> Result<git::RefComparison, GitError> {
    with_repo(&path, |r| git::compare_refs(r, &base, &head))
}

#[tauri::command]
pub fn get_compare_file_diff(path: String, base: String, head: String, file_path: String) -> Result<git::FileDiff, GitError> {
    with_repo(&path, |r| git::get_compare_file_diff(r, &base, &head, &file_path))
}

// ---------------------------------------------------------------- Mise à jour d'une branche de PR

#[tauri::command]
pub fn branch_divergence(path: String, base: String, head: String) -> Result<git::BranchDivergence, GitError> {
    with_repo(&path, |r| git::branch_divergence(r, &base, &head))
}

/// Rebase en mémoire : la copie de travail n'est pas touchée.
#[tauri::command]
pub fn rebase_pull_request(path: String, onto: String, head: String, branch: String) -> Result<git::PrRebase, GitError> {
    with_repo(&path, |r| git::rebase_pull_request(r, &onto, &head, &branch))
}

#[tauri::command]
pub fn discard_pull_request_rebase(path: String, branch: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::discard_pull_request_rebase(r, &branch))
}

#[tauri::command]
pub async fn force_push_pull_request(
    app: AppHandle,
    path: String,
    remote: String,
    branch: String,
    expected: String,
) -> Result<git::PrPush, GitError> {
    // La branche locale peut être extraite et mise à jour : les fichiers LFS sont remis en place.
    network(&app, move |creds| with_repo_lfs(&path, |r| git::force_push_pull_request(r, &remote, &branch, &expected, creds))).await
}

// ---------------------------------------------------------------- Copie de travail

#[tauri::command]
pub fn get_status(path: String) -> Result<Vec<git::FileStatus>, GitError> {
    with_repo(&path, git::get_status)
}

#[tauri::command]
pub fn get_diff(path: String, file_path: String, staged: bool) -> Result<git::FileDiff, GitError> {
    with_repo(&path, |r| git::get_diff(r, &file_path, staged))
}

#[tauri::command]
pub fn stage_files(path: String, paths: Vec<String>) -> Result<(), GitError> {
    with_repo(&path, |r| git::stage_paths(r, &paths))
}

#[tauri::command]
pub fn stage_all(path: String) -> Result<(), GitError> {
    with_repo(&path, git::stage_all)
}

#[tauri::command]
pub fn unstage_files(path: String, paths: Vec<String>) -> Result<(), GitError> {
    with_repo(&path, |r| git::unstage_paths(r, &paths))
}

#[tauri::command]
pub fn unstage_all(path: String) -> Result<(), GitError> {
    with_repo(&path, git::unstage_all)
}

#[tauri::command]
pub fn discard_files(path: String, paths: Vec<String>) -> Result<(), GitError> {
    with_repo(&path, |r| git::discard_paths(r, &paths))
}

/// Ajoute des motifs au .gitignore racine du dépôt.
#[tauri::command]
pub fn ignore_patterns(path: String, patterns: Vec<String>) -> Result<(), GitError> {
    with_repo(&path, |r| git::ignore_patterns(r, &patterns))
}

/// Indexe / désindexe / annule un bloc (`lines` absent) ou des lignes d'un bloc.
#[tauri::command]
pub fn apply_lines(
    path: String,
    file_path: String,
    hunk: usize,
    lines: Option<Vec<usize>>,
    action: git::LineAction,
) -> Result<(), GitError> {
    with_repo(&path, |r| git::apply_lines(r, &file_path, hunk, lines, action))
}

#[tauri::command]
pub fn create_commit(path: String, message: String, amend: bool) -> Result<String, GitError> {
    with_repo(&path, |r| git::create_commit(r, &message, amend))
}

#[tauri::command]
pub fn get_conflict_content(path: String, file_path: String) -> Result<String, GitError> {
    with_repo(&path, |r| git::get_conflict_content(r, &file_path))
}

#[tauri::command]
pub fn resolve_conflict(path: String, file_path: String, content: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::resolve_conflict(r, &file_path, &content))
}

// ---------------------------------------------------------------- Stash

#[tauri::command]
pub fn list_stashes(path: String) -> Result<Vec<git::StashInfo>, GitError> {
    with_repo_mut(&path, git::list_stashes)
}

#[tauri::command]
pub fn stash_save(path: String, message: Option<String>, include_untracked: bool) -> Result<(), GitError> {
    with_repo_mut(&path, |r| git::stash_save(r, message.as_deref(), include_untracked))
}

#[tauri::command]
pub fn stash_apply(path: String, index: usize, pop: bool) -> Result<(), GitError> {
    with_repo_mut(&path, |r| {
        git::stash_apply(r, index, pop)?;
        let _ = git::lfs::lfs_checkout(r);
        Ok(())
    })
}

#[tauri::command]
pub fn stash_drop(path: String, index: usize) -> Result<(), GitError> {
    with_repo_mut(&path, |r| git::stash_drop(r, index))
}

// ---------------------------------------------------------------- Branches & commits

#[tauri::command]
pub fn checkout_branch(path: String, name: String) -> Result<(), GitError> {
    with_repo_lfs(&path, |r| git::checkout_branch(r, &name))
}

#[tauri::command]
pub fn checkout_remote_branch(path: String, name: String) -> Result<String, GitError> {
    with_repo_lfs(&path, |r| git::checkout_remote_branch(r, &name))
}

#[tauri::command]
pub fn checkout_commit(path: String, hash: String) -> Result<(), GitError> {
    with_repo_lfs(&path, |r| git::checkout_commit(r, &hash))
}

#[tauri::command]
pub fn create_branch(path: String, name: String, from_ref: String, checkout: bool) -> Result<(), GitError> {
    with_repo_lfs(&path, |r| {
        git::create_branch(r, &name, &from_ref)?;
        if checkout {
            git::checkout_branch(r, &name)?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn delete_branch(path: String, name: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::delete_branch(r, &name))
}

#[tauri::command]
pub fn rename_branch(path: String, old_name: String, new_name: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::rename_branch(r, &old_name, &new_name))
}

#[tauri::command]
pub fn set_upstream(path: String, name: String, upstream: Option<String>) -> Result<(), GitError> {
    with_repo(&path, |r| git::set_upstream(r, &name, upstream.as_deref()))
}

#[tauri::command]
pub fn merge_branch(path: String, branch: String) -> Result<git::MergeResult, GitError> {
    with_repo_lfs(&path, |r| git::merge_branch(r, &branch))
}

#[tauri::command]
pub fn abort_merge(path: String) -> Result<(), GitError> {
    with_repo_lfs(&path, git::abort_merge)
}

#[tauri::command]
pub fn rebase_onto(path: String, onto: String) -> Result<git::RebaseResult, GitError> {
    with_repo_lfs(&path, |r| git::rebase_onto(r, &onto))
}

#[tauri::command]
pub fn continue_rebase(path: String) -> Result<git::RebaseResult, GitError> {
    with_repo_lfs(&path, git::continue_rebase)
}

#[tauri::command]
pub fn abort_rebase(path: String) -> Result<(), GitError> {
    with_repo_lfs(&path, git::abort_rebase)
}

/// Commits réécrits par un rebase interactif sur `base`, du plus ancien au plus récent.
#[tauri::command]
pub fn rebase_todo(path: String, base: String) -> Result<Vec<git::TodoCommit>, GitError> {
    with_repo(&path, |r| git::rebase_todo(r, &base))
}

#[tauri::command]
pub fn interactive_rebase(
    path: String,
    base: String,
    steps: Vec<git::RebaseStep>,
    mode: git::RebaseMode,
) -> Result<git::InteractiveOutcome, GitError> {
    with_repo_lfs(&path, |r| git::interactive_rebase(r, &base, &steps, mode))
}

#[tauri::command]
pub fn continue_interactive_rebase(path: String) -> Result<git::InteractiveOutcome, GitError> {
    with_repo_lfs(&path, git::continue_interactive)
}

#[tauri::command]
pub fn abort_interactive_rebase(path: String) -> Result<(), GitError> {
    with_repo_lfs(&path, git::abort_interactive)
}

#[tauri::command]
pub fn reset_to(path: String, hash: String, mode: String) -> Result<(), GitError> {
    with_repo_lfs(&path, |r| git::reset_to(r, &hash, &mode))
}

#[tauri::command]
pub fn cherry_pick(path: String, hash: String) -> Result<git::MergeResult, GitError> {
    with_repo_lfs(&path, |r| git::cherry_pick(r, &hash))
}

#[tauri::command]
pub fn revert_commit(path: String, hash: String) -> Result<git::MergeResult, GitError> {
    with_repo_lfs(&path, |r| git::revert_commit(r, &hash))
}

#[tauri::command]
pub fn create_tag(path: String, name: String, target: String, message: Option<String>) -> Result<(), GitError> {
    with_repo(&path, |r| git::create_tag(r, &name, &target, message.as_deref()))
}

#[tauri::command]
pub fn delete_tag(path: String, name: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::delete_tag(r, &name))
}

// ---------------------------------------------------------------- Remotes

#[tauri::command]
pub fn list_remotes(path: String) -> Result<Vec<git::RemoteInfo>, GitError> {
    with_repo(&path, git::list_remotes)
}

#[tauri::command]
pub fn add_remote(path: String, name: String, url: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::add_remote(r, &name, &url))
}

#[tauri::command]
pub fn remove_remote(path: String, name: String) -> Result<(), GitError> {
    with_repo(&path, |r| git::remove_remote(r, &name))
}

/// Clone puis initialise les sous-modules. Renvoie un avertissement si ces derniers échouent
/// (le dépôt principal reste cloné et utilisable).
#[tauri::command]
pub async fn clone_repository(app: AppHandle, url: String, path: String) -> Result<Option<String>, GitError> {
    network(&app, move |creds| {
        git::clone_repo(&url, &path, creds)?;
        let mut warnings = Vec::new();
        if let Err(e) = with_repo(&path, |r| git::update_submodules(r, &[], creds)) {
            warnings.push(format!("les sous-modules n'ont pas pu être récupérés : {e}"));
        }
        if let Err(e) = with_repo(&path, |r| git::lfs::lfs_pull(r, creds(&url).as_ref())) {
            warnings.push(format!("les fichiers LFS n'ont pas pu être récupérés : {e}"));
        }
        Ok((!warnings.is_empty()).then(|| format!("Dépôt cloné, mais {}", warnings.join(" ; "))))
    })
    .await
}

#[tauri::command]
pub fn list_submodules(path: String) -> Result<Vec<git::SubmoduleInfo>, GitError> {
    with_repo(&path, git::list_submodules)
}

/// `names` vide : tous les sous-modules.
#[tauri::command]
pub async fn update_submodules(app: AppHandle, path: String, names: Vec<String>) -> Result<(), GitError> {
    network(&app, move |creds| with_repo(&path, |r| git::update_submodules(r, &names, creds))).await
}

/// `remote` absent : fetch de tous les remotes.
#[tauri::command]
pub async fn fetch_remote(app: AppHandle, path: String, remote: Option<String>) -> Result<(), GitError> {
    network(&app, move |creds| {
        with_repo(&path, |r| match &remote {
            Some(name) => git::fetch(r, name, creds),
            None => git::fetch_all(r, creds),
        })
    })
    .await
}

#[tauri::command]
pub async fn pull(app: AppHandle, path: String, rebase: bool) -> Result<git::MergeResult, GitError> {
    network(&app, move |creds| {
        with_repo(&path, |r| {
            let result = git::pull(r, rebase, creds)?;
            let head = r.head()?.name().unwrap_or("").to_string();
            let remote = r
                .branch_upstream_remote(&head)
                .ok()
                .and_then(|b| b.as_str().ok().map(str::to_string))
                .unwrap_or_else(|| "origin".into());
            git::lfs::lfs_pull(r, creds(&remote_url(r, &remote)).as_ref())?;
            Ok(result)
        })
    })
    .await
}

/// Push d'une branche (la branche courante par défaut) vers son remote de suivi,
/// ou vers `remote` / `origin` si elle n'en a pas encore.
#[tauri::command]
pub async fn push(
    app: AppHandle,
    path: String,
    branch: Option<String>,
    remote: Option<String>,
    force: bool,
) -> Result<(), GitError> {
    network(&app, move |creds| {
        with_repo(&path, |r| {
            let branch = match branch {
                Some(b) => b,
                None => r
                    .head()
                    .ok()
                    .filter(|_| !r.head_detached().unwrap_or(false))
                    .and_then(|h| h.shorthand().ok().map(str::to_string))
                    .ok_or_else(|| GitError::Other("Aucune branche courante à pousser".into()))?,
            };
            let remote = match remote {
                Some(name) => name,
                None => default_push_remote(r, &branch)?,
            };
            // Les objets LFS doivent être sur le serveur avant les commits qui les référencent.
            git::lfs::lfs_push(r, &remote, &branch, creds(&remote_url(r, &remote)).as_ref())?;
            git::push_branch(r, &remote, &branch, force, creds)
        })
    })
    .await
}

fn default_push_remote(repo: &Repository, branch: &str) -> Result<String, GitError> {
    if let Ok(remote) = repo.branch_upstream_remote(&format!("refs/heads/{branch}")) {
        if let Ok(name) = remote.as_str() {
            return Ok(name.to_string());
        }
    }
    let remotes = repo.remotes()?;
    let names: Vec<&str> = remotes.iter().filter_map(|r| r.ok().flatten()).collect();
    if names.contains(&"origin") {
        return Ok("origin".into());
    }
    names
        .first()
        .map(|n| n.to_string())
        .ok_or_else(|| GitError::Other("Aucun remote configuré : ajoute-en un avant de pousser".into()))
}

#[tauri::command]
pub async fn delete_remote_branch(app: AppHandle, path: String, name: String) -> Result<(), GitError> {
    network(&app, move |creds| with_repo(&path, |r| git::delete_remote_branch(r, &name, creds))).await
}

#[tauri::command]
pub async fn push_tag(app: AppHandle, path: String, remote: String, tag: String) -> Result<(), GitError> {
    network(&app, move |creds| with_repo(&path, |r| git::push_tag(r, &remote, &tag, creds))).await
}

#[tauri::command]
pub async fn delete_remote_tag(app: AppHandle, path: String, remote: String, tag: String) -> Result<(), GitError> {
    network(&app, move |creds| with_repo(&path, |r| git::delete_remote_tag(r, &remote, &tag, creds))).await
}

// ---------------------------------------------------------------- LFS

#[tauri::command]
pub fn lfs_status(path: String) -> Result<git::lfs::LfsStatus, GitError> {
    with_repo(&path, git::lfs::lfs_status)
}

/// Télécharge les fichiers LFS de la révision courante.
#[tauri::command]
pub async fn lfs_pull(app: AppHandle, path: String) -> Result<(), GitError> {
    network(&app, move |creds| {
        with_repo(&path, |r| {
            let remote = if r.find_remote("origin").is_ok() {
                "origin".to_string()
            } else {
                r.remotes()?.iter().filter_map(|r| r.ok().flatten()).next().unwrap_or("origin").to_string()
            };
            git::lfs::lfs_pull(r, creds(&remote_url(r, &remote)).as_ref())
        })
    })
    .await
}

/// Suit (ou ne suit plus, si `untrack`) un motif de fichiers avec LFS.
#[tauri::command]
pub fn lfs_track(path: String, pattern: String, untrack: bool) -> Result<(), GitError> {
    with_repo(&path, |r| git::lfs::lfs_track(r, &pattern, untrack))
}

// ---------------------------------------------------------------- Comptes

#[tauri::command]
pub fn list_accounts(app: AppHandle) -> Result<Vec<Account>, String> {
    account_store(&app)?.list()
}

/// Vérifie un token personnel auprès de l'instance et renvoie le nom d'utilisateur associé.
fn username_for_token(provider: Provider, base_url: &str, token: &str) -> Result<String, String> {
    crate::accounts::validate_base_url(base_url)?;
    oauth::fetch_username(provider, &oauth::endpoints(provider, base_url), token.trim())
        .map_err(|_| "Token refusé par l'instance : vérifie sa validité et ses droits (scopes)".to_string())
}

async fn blocking_str<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Ajoute un compte avec un token personnel, après l'avoir validé auprès de l'instance.
#[tauri::command]
pub async fn add_pat_account(
    app: AppHandle,
    provider: Provider,
    base_url: String,
    token: String,
    label: Option<String>,
) -> Result<SavedAccount, String> {
    let store = account_store(&app)?;
    blocking_str(move || {
        let base_url = base_url.trim().trim_end_matches('/').to_string();
        let username = username_for_token(provider, &base_url, &token)?;
        let host = crate::accounts::url_host(&base_url).unwrap_or_default();
        let account = Account {
            id: String::new(),
            provider,
            label: label.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| format!("{username}@{host}")),
            base_url,
            username,
            auth: AuthKind::Pat,
        };
        store.save(account, Some(token.trim()))
    })
    .await
}

/// Remplace le token personnel d'un compte (validé auprès de l'instance).
#[tauri::command]
pub async fn update_account_token(app: AppHandle, id: String, token: String) -> Result<SavedAccount, String> {
    let store = account_store(&app)?;
    blocking_str(move || {
        let mut account = store.get(&id)?;
        account.username = username_for_token(account.provider, &account.base_url, &token)?;
        account.auth = AuthKind::Pat;
        store.save(account, Some(token.trim()))
    })
    .await
}

#[tauri::command]
pub fn rename_account(app: AppHandle, id: String, label: String) -> Result<SavedAccount, String> {
    let store = account_store(&app)?;
    let mut account = store.get(&id)?;
    let label = label.trim();
    if label.is_empty() {
        return Err("Le nom ne peut pas être vide".into());
    }
    account.label = label.to_string();
    store.save(account, None)
}

#[tauri::command]
pub fn remove_account(app: AppHandle, id: String) -> Result<(), String> {
    account_store(&app)?.remove(&id)
}

/// Requête GET sur l'API GitHub / GitLab du compte. Le token reste côté Rust.
#[tauri::command]
pub async fn forge_api(app: AppHandle, account_id: String, path: String) -> Result<serde_json::Value, String> {
    let store = account_store(&app)?;
    blocking_str(move || {
        let account = store.get(&account_id)?;
        let token = store.token(&account.id)?;
        crate::forge::get_json(&account, &token, &path)
    })
    .await
}

/// Requête d'écriture (POST / PUT / PATCH) sur l'API du compte : création de pull / merge requests…
#[tauri::command]
pub async fn forge_api_send(
    app: AppHandle,
    account_id: String,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let store = account_store(&app)?;
    blocking_str(move || {
        let account = store.get(&account_id)?;
        let token = store.token(&account.id)?;
        crate::forge::request_json(&account, &token, &method, &path, body.as_ref())
    })
    .await
}

/// Requête GraphQL GitHub (opérations absentes de l'API REST, comme le passage brouillon ↔ prête).
#[tauri::command]
pub async fn forge_graphql(
    app: AppHandle,
    account_id: String,
    query: String,
    variables: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let store = account_store(&app)?;
    blocking_str(move || {
        let account = store.get(&account_id)?;
        let token = store.token(&account.id)?;
        crate::forge::graphql(&account, &token, &query, &variables)
    })
    .await
}

// ---------------------------------------------------------------- OAuth (device flow)

#[derive(serde::Serialize)]
pub struct OAuthDefaults {
    github: Option<String>,
    gitlab: Option<String>,
}

/// Identifiant client OAuth par défaut : variable d'environnement au lancement de l'application,
/// sinon valeur intégrée à la compilation.
fn client_id_default(runtime: Option<String>, built_in: Option<&str>) -> Option<String> {
    runtime
        .or_else(|| built_in.map(str::to_string))
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

/// Identifiants client OAuth par défaut (GIT_CLIENT_GITHUB_CLIENT_ID, GIT_CLIENT_GITLAB_CLIENT_ID).
#[tauri::command]
pub fn oauth_defaults() -> OAuthDefaults {
    OAuthDefaults {
        github: client_id_default(
            std::env::var("GIT_CLIENT_GITHUB_CLIENT_ID").ok(),
            option_env!("GIT_CLIENT_GITHUB_CLIENT_ID"),
        ),
        gitlab: client_id_default(
            std::env::var("GIT_CLIENT_GITLAB_CLIENT_ID").ok(),
            option_env!("GIT_CLIENT_GITLAB_CLIENT_ID"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::client_id_default;

    #[test]
    fn runtime_value_wins_over_built_in() {
        assert_eq!(client_id_default(Some("run".into()), Some("built")).as_deref(), Some("run"));
        assert_eq!(client_id_default(None, Some(" built ")).as_deref(), Some("built"));
        assert_eq!(client_id_default(Some("  ".into()), None), None);
        assert_eq!(client_id_default(None, None), None);
    }
}

/// Démarre une connexion : renvoie le code à saisir dans le navigateur.
#[tauri::command]
pub async fn oauth_start(provider: Provider, base_url: String, client_id: String) -> Result<oauth::DeviceCode, String> {
    crate::accounts::validate_base_url(&base_url)?;
    tauri::async_runtime::spawn_blocking(move || oauth::start(&oauth::endpoints(provider, &base_url), client_id.trim()))
        .await
        .map_err(|e| e.to_string())?
}

/// Attend la validation du code, puis enregistre le compte.
#[tauri::command]
pub async fn oauth_complete(
    app: AppHandle,
    provider: Provider,
    base_url: String,
    client_id: String,
    device: oauth::DeviceCode,
    label: Option<String>,
) -> Result<SavedAccount, String> {
    crate::accounts::validate_base_url(&base_url)?;
    let store = account_store(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let endpoints = oauth::endpoints(provider, &base_url);
        let cancel = oauth::register_cancel(&device.device_code);
        let token = oauth::wait_for_token(&endpoints, client_id.trim(), &device, &cancel);
        oauth::unregister(&device.device_code);
        let token = token?;
        let username = oauth::fetch_username(provider, &endpoints, &token.access_token)?;
        let host = crate::accounts::url_host(&base_url).unwrap_or_default();
        let account = Account {
            id: String::new(),
            provider,
            label: label.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| format!("{username}@{host}")),
            base_url,
            username,
            auth: AuthKind::Oauth,
        };
        store.save_oauth(account, &token)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn oauth_cancel(device_code: String) {
    oauth::cancel(&device_code);
}

/// Environnement d'exécution, affiché dans « À propos » et joint aux rapports de bug.
#[derive(serde::Serialize)]
pub struct AppInfo {
    os: &'static str,
    arch: &'static str,
    libgit2: String,
    debug: bool,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    let (major, minor, patch) = git2::Version::get().libgit2_version();
    AppInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        libgit2: format!("{major}.{minor}.{patch}"),
        debug: cfg!(debug_assertions),
    }
}

/// Outils de développement du webview (builds de debug uniquement).
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

// ---------------------------------------------------------------- Terminal intégré

#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    window: tauri::Window,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: tauri::ipc::Channel<crate::terminal::TerminalEvent>,
) -> Result<u32, String> {
    crate::terminal::open(&app, window.label(), &cwd, cols, rows, on_event)
}

#[tauri::command]
pub fn terminal_write(app: AppHandle, id: u32, data: String) -> Result<(), String> {
    crate::terminal::write(&app, id, &data)
}

#[tauri::command]
pub fn terminal_resize(app: AppHandle, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    crate::terminal::resize(&app, id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(app: AppHandle, id: u32) {
    crate::terminal::close(&app, id)
}
