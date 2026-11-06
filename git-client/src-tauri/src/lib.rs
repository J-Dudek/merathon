#[cfg(desktop)]
use tauri::Manager;

#[macro_use]
mod i18n;
mod latest_release;
mod accounts;
mod commands;
mod debug_log;
mod device_storage;
mod forge;
mod http;
mod notifications;
mod oauth;
mod pr_watch;
mod ssh_setup;
// SSH sans OpenSSH (issue #38) : Android, et tests sur le bureau contre un vrai serveur OpenSSH.
#[cfg(any(target_os = "android", test))]
mod known_hosts;
#[cfg(any(target_os = "android", test))]
mod ssh_native;
#[cfg(any(target_os = "android", test))]
mod ssh_signer;
#[cfg(any(target_os = "android", test))]
mod android_keystore;
#[cfg(test)]
mod test_sshd;
#[cfg(test)]
mod bench;
mod git;
#[cfg(desktop)]
mod terminal;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_wsl_environment();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    // Mises à jour (hors du Play Store, qui les gère lui-même), redémarrage et terminaux : bureau seulement.
    #[cfg(desktop)]
    let builder = builder
        .manage(terminal::Terminals::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|_app| {
            // Sans certificats, seul le HTTPS de Git échoue : l'application doit quand même démarrer.
            #[cfg(target_os = "android")]
            {
                device_storage::set_home(_app);
                match device_storage::trust_system_certificates() {
                    Ok(count) => eprintln!("certificats du système : {count}"),
                    Err(e) => eprintln!("certificats du système indisponibles : {e}"),
                }
            }
            // Premier appel à libgit2, qui lit HOME une fois pour toutes à son initialisation : il doit suivre
            // set_home, sinon Android n'a plus de configuration globale (« no configuration exists for the given level '4' »).
            if let Err(e) = git::configure_network_timeouts() {
                eprintln!("Délais réseau de libgit2 non appliqués : {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            i18n::set_language,
            commands::open_new_window,
            notifications::notify_desktop,
            notifications::close_desktop_notification,
            pr_watch::pr_watch_configure,
            pr_watch::pr_watch_snapshot,
            pr_watch::pr_watch_state,
            latest_release::latest_release,
            notifications::is_wsl,
            commands::open_repository,
            commands::trust_repository,
            commands::get_repo_info,
            commands::init_repository,
            commands::get_identity,
            commands::set_identity,
            commands::get_commits,
            commands::get_branches,
            commands::get_tags,
            commands::get_commit_details,
            commands::get_commit_file_diff,
            commands::compare_refs,
            commands::diff_commits,
            commands::commit_trailers,
            commands::branch_divergence,
            commands::rebase_pull_request,
            commands::discard_pull_request_rebase,
            commands::force_push_pull_request,
            commands::get_compare_file_diff,
            commands::get_status,
            commands::get_diff,
            commands::stage_files,
            commands::stage_all,
            commands::unstage_files,
            commands::unstage_all,
            commands::discard_files,
            commands::ignore_patterns,
            commands::apply_lines,
            commands::create_commit,
            commands::reword_head,
            commands::get_conflict_content,
            commands::resolve_conflict,
            commands::list_files,
            commands::read_file,
            commands::write_file,
            commands::delete_file,
            commands::list_stashes,
            commands::stash_save,
            commands::stash_apply,
            commands::stash_drop,
            commands::checkout_branch,
            commands::checkout_remote_branch,
            commands::checkout_commit,
            commands::create_branch,
            commands::delete_branch,
            commands::rename_branch,
            commands::set_upstream,
            commands::merge_branch,
            commands::fast_forward,
            commands::fast_forward_branch,
            commands::abort_merge,
            commands::rebase_onto,
            commands::continue_rebase,
            commands::abort_rebase,
            commands::rebase_todo,
            commands::interactive_rebase,
            commands::continue_interactive_rebase,
            commands::abort_interactive_rebase,
            commands::reset_to,
            commands::cherry_pick,
            commands::revert_commit,
            commands::create_tag,
            commands::delete_tag,
            commands::list_remotes,
            commands::add_remote,
            commands::remove_remote,
            commands::clone_repository,
            commands::ssh_setup_info,
            commands::ssh_all_keys,
            commands::list_git_profiles,
            commands::save_git_profile,
            commands::delete_git_profile,
            commands::git_identity_status,
            commands::clear_local_identity,
            commands::ssh_create_key,
            commands::ssh_existing_key,
            commands::ssh_host_status,
            commands::ssh_trust_host,
            commands::ssh_check_connection,
            commands::ssh_device_key_status,
            commands::ssh_device_key_delete,
            commands::list_submodules,
            commands::update_submodules,
            commands::list_worktrees,
            commands::add_worktree,
            commands::remove_worktree,
            commands::lfs_status,
            commands::lfs_pull,
            commands::lfs_track,
            commands::fetch_remote,
            commands::pull,
            commands::push,
            commands::delete_remote_branch,
            commands::push_tag,
            commands::delete_remote_tag,
            commands::list_accounts,
            commands::add_pat_account,
            commands::update_account_token,
            commands::rename_account,
            commands::remove_account,
            commands::forge_api,
            commands::forge_api_send,
            commands::forge_graphql,
            commands::oauth_defaults,
            commands::oauth_start,
            commands::oauth_complete,
            commands::oauth_cancel,
            commands::device_repos_root,
            commands::list_device_folders,
            commands::create_device_folder,
            commands::app_info,
            debug_log::set_debug_logging,
            commands::open_devtools,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::Destroyed = _event {
                _window.state::<terminal::Terminals>().close_window(_window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Variables d'environnement posées sous WSL (WSLg), avant le démarrage de Tauri.
/// - `GDK_BACKEND=x11` : une fenêtre Wayland n'a pas d'icône dans la barre des tâches Windows (pingouin par défaut) ;
///   en X11 (XWayland), l'icône de la fenêtre est transmise.
/// - `WEBKIT_DISABLE_DMABUF_RENDERER=1` et `LIBGL_ALWAYS_SOFTWARE=1` : selon le GPU et son pilote Windows, le rendu
///   accéléré de WebKitGTK laisse des zones non redessinées (rectangles blancs sur le graphe) ; rendu logiciel à la place.
#[cfg(target_os = "linux")]
const WSL_ENV: [(&str, &str); 3] = [
    ("GDK_BACKEND", "x11"),
    ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    ("LIBGL_ALWAYS_SOFTWARE", "1"),
];

/// Pose les variables de [`WSL_ENV`] sous WSL ; une variable déjà définie par l'utilisateur est respectée.
#[cfg(target_os = "linux")]
fn configure_wsl_environment() {
    if !is_wsl() {
        return;
    }
    for (name, value) in WSL_ENV {
        if std::env::var_os(name).is_none() {
            // Appelé avant le démarrage de Tauri, quand aucun autre thread ne lit l'environnement.
            std::env::set_var(name, value);
        }
    }
}

/// Merathon tourne dans WSL (1 ou 2).
#[cfg(target_os = "linux")]
pub(crate) fn is_wsl() -> bool {
    let osrelease = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
    std::env::var_os("WSL_DISTRO_NAME").is_some() || is_wsl_kernel(&osrelease)
}

/// Noyau de WSL : « 5.15.167.4-microsoft-standard-WSL2 », « 4.4.0-19041-Microsoft » (WSL 1).
#[cfg(target_os = "linux")]
fn is_wsl_kernel(osrelease: &str) -> bool {
    osrelease.to_lowercase().contains("microsoft")
}

#[cfg(all(test, target_os = "linux"))]
mod wsl_tests {
    use super::is_wsl_kernel;

    #[test]
    fn detects_wsl_kernels() {
        assert!(is_wsl_kernel("5.15.167.4-microsoft-standard-WSL2\n"));
        assert!(is_wsl_kernel("4.4.0-19041-Microsoft"));
        assert!(!is_wsl_kernel("7.0.0-38-generic"));
    }
}
