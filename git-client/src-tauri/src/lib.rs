use tauri::Manager;

mod accounts;
mod commands;
mod forge;
mod http;
mod oauth;
mod git;
mod terminal;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(terminal::Terminals::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_new_window,
            commands::open_repository,
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
