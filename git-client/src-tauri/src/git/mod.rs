mod error;
mod auth;
mod repository;
mod history;
mod status;
mod diff;
mod remote;
mod merge;
mod ops;
mod commit;
mod stash;
mod patch;
mod paths;
mod interactive;
mod pr_rebase;
mod submodule;
pub mod lfs;

pub use error::GitError;
pub use auth::Credentials;
pub use repository::{open_repo, repo_info, get_identity, set_identity, RepoInfo, Identity};
pub use history::{get_commits, get_branches, get_tags, get_commit_details, compare_refs, CommitInfo, BranchInfo, TagInfo, CommitDetails, RefComparison};
pub use status::{get_status, stage_paths, stage_all, unstage_paths, unstage_all, discard_paths, FileStatus};
pub use diff::{get_diff, get_commit_file_diff, get_compare_file_diff, FileDiff};
pub use remote::{
    init_repo, clone_repo, fetch, fetch_all, pull, push_branch, delete_remote_branch, push_tag,
    delete_remote_tag, list_remotes, add_remote, remove_remote, RemoteInfo,
};
pub use merge::{merge_branch, abort_merge, get_conflict_content, resolve_conflict, MergeResult};
pub use ops::{
    checkout_branch, checkout_remote_branch, checkout_commit, create_branch, delete_branch,
    rename_branch, set_upstream, rebase_onto, continue_rebase, abort_rebase, reset_to,
    cherry_pick, revert_commit, create_tag, delete_tag, RebaseResult,
};
pub use commit::create_commit;
pub use interactive::{
    rebase_todo, interactive_rebase, continue_interactive, abort_interactive, InteractiveOutcome,
    RebaseMode, RebaseStep, TodoCommit,
};
pub use pr_rebase::{
    branch_divergence, rebase_pull_request, discard_pull_request_rebase, force_push_pull_request, BranchDivergence,
    PrRebase, PrPush,
};
pub use submodule::{list_submodules, update_submodules, SubmoduleInfo};
pub use patch::{apply_lines, LineAction};
pub use stash::{list_stashes, stash_save, stash_apply, stash_drop, StashInfo};
