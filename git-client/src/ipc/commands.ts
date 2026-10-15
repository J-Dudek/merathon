import { Channel, invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import type {
  BranchDivergence, BranchInfo, CommitDetails, CommitFile, PrPush, PrRebase, CommitInfo, FileDiff, FileStatus, Identity, MergeResult,
  InteractiveOutcome, LfsStatus, RefComparison, RemoteInfo, RepoInfo, StashInfo, SubmoduleInfo, TagInfo, TodoCommit,
} from "../types/git";
import type { DeviceCode, ForgeAccount, Provider, SavedAccount } from "../types/forge";
import { describeCommand } from "../lib/journal";
import { useJournalStore } from "../store/useJournalStore";

function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  return e instanceof Error ? e.message : String(e);
}

/** Appel au backend ; les opérations qui modifient un dépôt sont inscrites au journal. */
async function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  const command = describeCommand(cmd, args);
  if (!command) return tauriInvoke<T>(cmd, args);
  const journal = useJournalStore.getState();
  const path = (args as { path?: unknown } | undefined)?.path;
  const id = journal.start(typeof path === "string" ? path : null, command);
  try {
    const result = await tauriInvoke<T>(cmd, args);
    const conflicts = (result as { conflicted_files?: string[] } | null)?.conflicted_files;
    if (conflicts?.length) journal.finish(id, "warning", `Conflits : ${conflicts.join(", ")}`);
    else journal.finish(id, "success");
    return result;
  } catch (e) {
    journal.finish(id, "error", errorText(e));
    throw e;
  }
}

// ---------------------------------------------------------------- Dépôt

export const openRepository = (path: string) => invoke<RepoInfo>("open_repository", { path });
export const getRepoInfo = (path: string) => invoke<RepoInfo>("get_repo_info", { path });
export const initRepository = (path: string) => invoke<void>("init_repository", { path });
/** `repo` : dépôt à ouvrir directement dans la nouvelle fenêtre. */
export const openNewWindow = (repo: string | null = null) => invoke<void>("open_new_window", { repo });

/** Notification du système (voir notifications.rs pour Linux) ; son identifiant quand elle peut être retirée ensuite. */
export const notifyDesktop = (title: string, body: string) => invoke<number | null>("notify_desktop", { title, body });
/** Retire une notification de la liste du système. */
export const closeDesktopNotification = (id: number) => invoke<void>("close_desktop_notification", { id });
export const isWsl = () => invoke<boolean>("is_wsl");

/** `path` null : identité globale. */
export const getIdentity = (path: string | null) => invoke<Identity>("get_identity", { path });
export const setIdentity = (path: string | null, name: string, email: string) =>
  invoke<void>("set_identity", { path, name, email });

// ---------------------------------------------------------------- Historique

export const getCommits = (path: string, limit = 1000) => invoke<CommitInfo[]>("get_commits", { path, limit });
export const getBranches = (path: string) => invoke<BranchInfo[]>("get_branches", { path });
export const getTags = (path: string) => invoke<TagInfo[]>("get_tags", { path });
export const getCommitDetails = (path: string, hash: string) =>
  invoke<CommitDetails>("get_commit_details", { path, hash });
export const getCommitFileDiff = (path: string, hash: string, filePath: string) =>
  invoke<FileDiff>("get_commit_file_diff", { path, hash, filePath });
/** Changements de `head` depuis son ancêtre commun avec `base`, comme le diff d'une pull request. */
export const compareRefs = (path: string, base: string, head: string) =>
  invoke<RefComparison>("compare_refs", { path, base, head });
/** Fichiers qui diffèrent entre deux commits quelconques (`git diff base head`). */
export const diffCommits = (path: string, base: string, head: string) => invoke<CommitFile[]>("diff_commits", { path, base, head });
export const getCompareFileDiff = (path: string, base: string, head: string, filePath: string) =>
  invoke<FileDiff>("get_compare_file_diff", { path, base, head, filePath });

// ---------------------------------------------------------------- Mise à jour d'une branche de PR

export const branchDivergence = (path: string, base: string, head: string) =>
  invoke<BranchDivergence>("branch_divergence", { path, base, head });
/** Rebase en mémoire de `head` sur `onto` : la copie de travail ne bouge pas, le résultat attend le force push. */
export const rebasePullRequest = (path: string, onto: string, head: string, branch: string) =>
  invoke<PrRebase>("rebase_pull_request", { path, onto, head, branch });
export const discardPullRequestRebase = (path: string, branch: string) =>
  invoke<void>("discard_pull_request_rebase", { path, branch });
/** Force push du rebase préparé, refusé si la branche distante n'est plus à `expected` (--force-with-lease). */
export const forcePushPullRequest = (path: string, remote: string, branch: string, expected: string) =>
  invoke<PrPush>("force_push_pull_request", { path, remote, branch, expected });

// ---------------------------------------------------------------- Copie de travail

export const getStatus = (path: string) => invoke<FileStatus[]>("get_status", { path });
export const getDiff = (path: string, filePath: string, staged: boolean) =>
  invoke<FileDiff>("get_diff", { path, filePath, staged });
export const stageFiles = (path: string, paths: string[]) => invoke<void>("stage_files", { path, paths });
export const stageAll = (path: string) => invoke<void>("stage_all", { path });
export const unstageFiles = (path: string, paths: string[]) => invoke<void>("unstage_files", { path, paths });
export const unstageAll = (path: string) => invoke<void>("unstage_all", { path });
export const discardFiles = (path: string, paths: string[]) => invoke<void>("discard_files", { path, paths });
export const ignorePatterns = (path: string, patterns: string[]) => invoke<void>("ignore_patterns", { path, patterns });
export type LineAction = "stage" | "unstage" | "discard";
/** `lines` null : tout le bloc. Index des lignes tels qu'affichés dans le bloc. */
export const applyLines = (path: string, filePath: string, hunk: number, lines: number[] | null, action: LineAction) =>
  invoke<void>("apply_lines", { path, filePath, hunk, lines, action });
export const createCommit = (path: string, message: string, amend = false) =>
  invoke<string>("create_commit", { path, message, amend });
/** Nouveau message pour le dernier commit, sans y ajouter les fichiers indexés. */
export const rewordHead = (path: string, message: string) => invoke<string>("reword_head", { path, message });
export const getConflictContent = (path: string, filePath: string) =>
  invoke<string>("get_conflict_content", { path, filePath });
export const resolveConflict = (path: string, filePath: string, content: string) =>
  invoke<void>("resolve_conflict", { path, filePath, content });

// ---------------------------------------------------------------- Stash

export const listStashes = (path: string) => invoke<StashInfo[]>("list_stashes", { path });
export const stashSave = (path: string, message: string | null, includeUntracked: boolean) =>
  invoke<void>("stash_save", { path, message, includeUntracked });
export const stashApply = (path: string, index: number, pop: boolean) =>
  invoke<void>("stash_apply", { path, index, pop });
export const stashDrop = (path: string, index: number) => invoke<void>("stash_drop", { path, index });

// ---------------------------------------------------------------- Branches & commits

export const checkoutBranch = (path: string, name: string) => invoke<void>("checkout_branch", { path, name });
export const checkoutRemoteBranch = (path: string, name: string) =>
  invoke<string>("checkout_remote_branch", { path, name });
export const checkoutCommit = (path: string, hash: string) => invoke<void>("checkout_commit", { path, hash });
export const createBranch = (path: string, name: string, fromRef: string, checkout = false) =>
  invoke<void>("create_branch", { path, name, fromRef, checkout });
export const deleteBranch = (path: string, name: string) => invoke<void>("delete_branch", { path, name });
export const renameBranch = (path: string, oldName: string, newName: string) =>
  invoke<void>("rename_branch", { path, oldName, newName });
export const setUpstream = (path: string, name: string, upstream: string | null) =>
  invoke<void>("set_upstream", { path, name, upstream });
export const mergeBranch = (path: string, branch: string) => invoke<MergeResult>("merge_branch", { path, branch });
/** Avance la branche courante jusqu'à `branch` ; refusé si elles ont divergé (jamais de commit de merge). */
export const fastForward = (path: string, branch: string) => invoke<void>("fast_forward", { path, branch });
/** Avance la branche locale `branch` jusqu'à `target` sans la checkout ; refusé si elles ont divergé. */
export const fastForwardBranch = (path: string, branch: string, target: string) =>
  invoke<void>("fast_forward_branch", { path, branch, target });
export const abortMerge = (path: string) => invoke<void>("abort_merge", { path });
export const rebaseOnto = (path: string, onto: string) => invoke<MergeResult>("rebase_onto", { path, onto });
export const continueRebase = (path: string) => invoke<MergeResult>("continue_rebase", { path });
export const abortRebase = (path: string) => invoke<void>("abort_rebase", { path });
export type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";
export interface RebaseStep {
  hash: string;
  action: RebaseAction;
  message: string | null;
}
export const rebaseTodo = (path: string, base: string) => invoke<TodoCommit[]>("rebase_todo", { path, base });
/** "linear" : merges aplatis, ordre libre ; "preserve" : merges conservés, ordre fixe. */
export type RebaseMode = "linear" | "preserve";
export const interactiveRebase = (path: string, base: string, steps: RebaseStep[], mode: RebaseMode = "linear") =>
  invoke<InteractiveOutcome>("interactive_rebase", { path, base, steps, mode });
export const continueInteractiveRebase = (path: string) =>
  invoke<InteractiveOutcome>("continue_interactive_rebase", { path });
export const abortInteractiveRebase = (path: string) => invoke<void>("abort_interactive_rebase", { path });
export const resetTo = (path: string, hash: string, mode: "soft" | "mixed" | "hard") =>
  invoke<void>("reset_to", { path, hash, mode });
export const cherryPick = (path: string, hash: string) => invoke<MergeResult>("cherry_pick", { path, hash });
export const revertCommit = (path: string, hash: string) => invoke<MergeResult>("revert_commit", { path, hash });
export const createTag = (path: string, name: string, target: string, message: string | null) =>
  invoke<void>("create_tag", { path, name, target, message });
export const deleteTag = (path: string, name: string) => invoke<void>("delete_tag", { path, name });

// ---------------------------------------------------------------- Remotes (réseau)

export const listRemotes = (path: string) => invoke<RemoteInfo[]>("list_remotes", { path });
export const addRemote = (path: string, name: string, url: string) => invoke<void>("add_remote", { path, name, url });
export const removeRemote = (path: string, name: string) => invoke<void>("remove_remote", { path, name });
/** Renvoie un avertissement si les sous-modules n'ont pas pu être récupérés. */
export const cloneRepository = (url: string, path: string) => invoke<string | null>("clone_repository", { url, path });
export const listSubmodules = (path: string) => invoke<SubmoduleInfo[]>("list_submodules", { path });
/** `names` vide : tous les sous-modules. */
export const updateSubmodules = (path: string, names: string[] = []) => invoke<void>("update_submodules", { path, names });
/** `remote` null : tous les remotes. */
export const fetchRemote = (path: string, remote: string | null = null) =>
  invoke<void>("fetch_remote", { path, remote });
/** Fetch de tous les remotes en arrière-plan (synchronisation périodique) : pas inscrit au journal. */
export const fetchAllQuietly = (path: string) => tauriInvoke<void>("fetch_remote", { path, remote: null });
/** Fetch d'un remote en arrière-plan (état d'une PR à l'ouverture) : pas inscrit au journal. */
export const fetchRemoteQuietly = (path: string, remote: string) => tauriInvoke<void>("fetch_remote", { path, remote });
export const pull = (path: string, rebase: boolean) => invoke<MergeResult>("pull", { path, rebase });
export const push = (path: string, opts: { branch?: string; remote?: string; force?: boolean } = {}) =>
  invoke<void>("push", { path, branch: opts.branch ?? null, remote: opts.remote ?? null, force: opts.force ?? false });
export const deleteRemoteBranch = (path: string, name: string) => invoke<void>("delete_remote_branch", { path, name });
export const pushTag = (path: string, remote: string, tag: string) => invoke<void>("push_tag", { path, remote, tag });
export const deleteRemoteTag = (path: string, remote: string, tag: string) =>
  invoke<void>("delete_remote_tag", { path, remote, tag });

// ---------------------------------------------------------------- LFS

export const lfsStatus = (path: string) => invoke<LfsStatus>("lfs_status", { path });
export const lfsPull = (path: string) => invoke<void>("lfs_pull", { path });
export const lfsTrack = (path: string, pattern: string, untrack = false) =>
  invoke<void>("lfs_track", { path, pattern, untrack });

// ---------------------------------------------------------------- Comptes

export const listAccounts = () => invoke<ForgeAccount[]>("list_accounts");
/** Valide le token auprès de l'instance puis enregistre le compte (token dans le trousseau). */
export const addPatAccount = (provider: Provider, baseUrl: string, token: string, label: string | null) =>
  invoke<SavedAccount>("add_pat_account", { provider, baseUrl, token, label });
export const updateAccountToken = (id: string, token: string) =>
  invoke<SavedAccount>("update_account_token", { id, token });
export const renameAccount = (id: string, label: string) => invoke<SavedAccount>("rename_account", { id, label });
export const removeAccount = (id: string) => invoke<void>("remove_account", { id });
/** GET sur l'API GitHub / GitLab du compte ; le token ne quitte pas le backend. */
export const forgeApi = (accountId: string, path: string) => invoke<unknown>("forge_api", { accountId, path });
/** POST / PUT / PATCH sur l'API GitHub / GitLab du compte (création de PR / MR…). */
export const forgeApiSend = (accountId: string, method: "POST" | "PUT" | "PATCH", path: string, body?: unknown) =>
  invoke<unknown>("forge_api_send", { accountId, method, path, body: body ?? null });

/** Requête GraphQL GitHub (opérations sans équivalent REST). */
export const forgeGraphql = (accountId: string, query: string, variables: Record<string, unknown>) =>
  invoke<unknown>("forge_graphql", { accountId, query, variables });

// ---------------------------------------------------------------- OAuth (device flow)

/** Identifiants client OAuth fournis à la compilation, s'il y en a. */
export const oauthDefaults = () => invoke<{ github: string | null; gitlab: string | null }>("oauth_defaults");
export const oauthStart = (provider: Provider, baseUrl: string, clientId: string) =>
  invoke<DeviceCode>("oauth_start", { provider, baseUrl, clientId });
/** Attend que l'utilisateur valide le code dans le navigateur, puis enregistre le compte. */
export const oauthComplete = (provider: Provider, baseUrl: string, clientId: string, device: DeviceCode, label: string | null) =>
  invoke<SavedAccount>("oauth_complete", { provider, baseUrl, clientId, device, label });
export const oauthCancel = (deviceCode: string) => invoke<void>("oauth_cancel", { deviceCode });

export interface AppInfo {
  os: string;
  arch: string;
  libgit2: string;
  /** Build de développement (`tauri dev`). */
  debug: boolean;
}

/** Environnement d'exécution : système, architecture et version de libgit2 embarquée. */
export const appInfo = () => invoke<AppInfo>("app_info");

/** Outils de développement (sans effet dans les builds de release). */
export const openDevtools = () => invoke<void>("open_devtools");

// ---------------------------------------------------------------- Terminal intégré

export type TerminalEvent = { kind: "output"; data: string } | { kind: "exit"; code: number | null };

/** Lance le shell de l'utilisateur dans `cwd` ; ses sorties arrivent dans `onEvent`. */
export const terminalOpen = (cwd: string, cols: number, rows: number, onEvent: (e: TerminalEvent) => void) => {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("terminal_open", { cwd, cols, rows, onEvent: channel });
};
export const terminalWrite = (id: number, data: string) => invoke<void>("terminal_write", { id, data });
export const terminalResize = (id: number, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows });
export const terminalClose = (id: number) => invoke<void>("terminal_close", { id });
