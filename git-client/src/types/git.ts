export type RefKind = "head" | "local" | "remote" | "tag";

export interface RefLabel {
  name: string;
  kind: RefKind;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parents: string[];
  refs: RefLabel[];
}

export interface BranchInfo {
  name: string;
  is_remote: boolean;
  target_hash: string;
  is_head: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface TagInfo {
  name: string;
  target_hash: string;
  message: string | null;
}

export interface StashInfo {
  index: number;
  message: string;
  hash: string;
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export type RepoState = "clean" | "merge" | "rebase" | "cherrypick" | "revert" | "bisect" | "apply";

export interface RepoInfo {
  path: string;
  head_branch: string | null;
  head_detached: boolean;
  head_hash: string | null;
  state: RepoState;
  pending_message: string | null;
  /** Rebase interactif arrêté (conflit à résoudre ou commit à modifier). */
  interactive_rebase: InteractiveStop | null;
}

export interface InteractiveStop {
  reason: "conflict" | "edit";
  hash: string;
  short_hash: string;
  summary: string;
  /** Étape (à partir de 1) parmi les commits conservés. */
  step: number;
  total: number;
  conflicted_files: string[];
}

export interface InteractiveOutcome {
  done: boolean;
  stopped: InteractiveStop | null;
}

export interface Identity {
  name: string | null;
  email: string | null;
}

export interface FileStatus {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
  staged: boolean;
}

export interface CommitFile {
  path: string;
  old_path: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "typechange";
  additions: number;
  deletions: number;
}

export interface CommitDetails {
  hash: string;
  short_hash: string;
  summary: string;
  message: string;
  author: string;
  email: string;
  author_time: number;
  committer: string;
  committer_email: string;
  commit_time: number;
  parents: string[];
  files: CommitFile[];
}

/** Comparaison de deux refs : fichiers modifiés depuis leur ancêtre commun. */
export interface RefComparison {
  merge_base: string;
  head: string;
  commits: number;
  files: CommitFile[];
}

/** Position d'une branche par rapport à sa cible. */
export interface BranchDivergence {
  /** Commit de tête de la branche, tel que connu localement. */
  head: string;
  ahead: number;
  /** Commits de la cible absents de la branche : elle est en retard s'il y en a. */
  behind: number;
}

/** Rebase en mémoire d'une branche de PR sur sa cible. */
export interface PrRebase {
  success: boolean;
  /** Rebase automatique impossible : rien n'a été modifié. */
  conflicted_files: string[];
  new_head: string | null;
  commits: number;
  /** Commits déjà présents dans la cible, ou commits de merge (retirés comme par `git rebase`). */
  skipped: number;
}

/** Effet du force push sur la branche locale du même nom. */
export type LocalBranchUpdate = "absent" | "updated" | "diverged" | "dirty";

export interface PrPush {
  new_head: string;
  local_branch: LocalBranchUpdate;
}

/** Résultat d'un merge, rebase, cherry-pick, revert ou pull. */
export interface MergeResult {
  conflicted_files: string[];
  success: boolean;
}

export interface DiffLine {
  kind: "context" | "added" | "removed";
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
}

export interface DiffHunk {
  header: string;
  old_start: number;
  new_start: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  is_binary: boolean;
}

/** Commit proposé dans le plan d'un rebase interactif. */
export interface TodoCommit {
  hash: string;
  short_hash: string;
  summary: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
  is_merge: boolean;
}

export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  branch: string | null;
  recorded_hash: string | null;
  checked_out_hash: string | null;
  state: "uninitialized" | "commit_changed" | "dirty" | "ok";
}

export interface LfsStatus {
  uses_lfs: boolean;
  /** Version de git-lfs, null s'il n'est pas installé. */
  version: string | null;
  patterns: string[];
  files: { path: string; downloaded: boolean }[];
}
