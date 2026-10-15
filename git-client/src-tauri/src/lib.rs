use tauri::Manager;

mod accounts;
mod commands;
mod forge;
mod http;
mod notifications;
mod oauth;
mod git;
mod terminal;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    use_x11_under_wsl();

    tauri::Builder::default()
        .manage(terminal::Terminals::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_new_window,
            notifications::notify_desktop,
            notifications::close_desktop_notification,
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
            commands::list_submodules,
            commands::update_submodules,
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
            commands::app_info,
            commands::open_devtools,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<terminal::Terminals>().close_window(window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Sous WSLg, une fenêtre Wayland n'a pas d'icône dans la barre des tâches Windows (pingouin par défaut) :
/// en X11 (XWayland), l'icône de la fenêtre est transmise. Un `GDK_BACKEND` déjà défini est respecté.
#[cfg(target_os = "linux")]
fn use_x11_under_wsl() {
    if std::env::var_os("GDK_BACKEND").is_some() {
        return;
    }
    if is_wsl() {
        // Appelé avant le démarrage de Tauri, quand aucun autre thread ne lit l'environnement.
        std::env::set_var("GDK_BACKEND", "x11");
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
