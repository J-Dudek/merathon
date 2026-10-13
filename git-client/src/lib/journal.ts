/**
 * Équivalent en ligne de commande des opérations git de l'application, pour le journal.
 * Les opérations passent par libgit2 : ces lignes décrivent ce qui est fait, elles ne sont pas exécutées telles quelles.
 */

type Args = Record<string, unknown>;

const short = (hash: unknown) => String(hash ?? "").slice(0, 7);

/** Argument shell lisible : entre guillemets s'il contient des espaces ou des caractères spéciaux. */
function quote(value: unknown): string {
  const s = String(value ?? "");
  return /^[\w@%+=:,./~^-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

function files(paths: unknown): string {
  const list = Array.isArray(paths) ? paths.map(quote) : [];
  return list.length > 5 ? `-- ${list.slice(0, 5).join(" ")} … (${list.length} fichiers)` : `-- ${list.join(" ")}`;
}

/** Retire un éventuel identifiant / token d'une URL (https://user:token@host/…). */
export function redactUrl(url: unknown): string {
  return String(url ?? "").replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
}

/** Assemble une ligne de commande en ignorant les options absentes. */
const join = (...parts: unknown[]) => parts.filter((p) => typeof p === "string" && p).join(" ");

const firstLine = (message: unknown) => String(message ?? "").split("\n")[0];

const COMMANDS: Record<string, (a: Args) => string> = {
  init_repository: (a) => `git init ${quote(a.path)}`,
  set_identity: (a) =>
    `git config ${a.path ? "" : "--global "}user.name ${quote(a.name)} && git config ${a.path ? "" : "--global "}user.email ${quote(a.email)}`,

  stage_files: (a) => `git add ${files(a.paths)}`,
  stage_all: () => "git add -A",
  unstage_files: (a) => `git restore --staged ${files(a.paths)}`,
  unstage_all: () => "git restore --staged :/",
  discard_files: (a) => `git restore ${files(a.paths)}`,
  apply_lines: (a) => {
    const flags: Record<string, string> = { stage: "--cached", unstage: "--cached --reverse", discard: "--reverse" };
    const part = a.lines ? "lignes choisies" : "bloc";
    return `git apply ${flags[String(a.action)] ?? ""} (${part} de ${quote(a.filePath)})`;
  },
  create_commit: (a) => `git commit ${a.amend ? "--amend " : ""}-m ${quote(firstLine(a.message))}`,
  resolve_conflict: (a) => `git add ${quote(a.filePath)}  # conflit résolu`,

  stash_save: (a) => join("git stash push", a.includeUntracked && "-u", a.message && `-m ${quote(a.message)}`),
  stash_apply: (a) => `git stash ${a.pop ? "pop" : "apply"} stash@{${a.index}}`,
  stash_drop: (a) => `git stash drop stash@{${a.index}}`,

  checkout_branch: (a) => `git switch ${quote(a.name)}`,
  checkout_remote_branch: (a) => `git switch --track ${quote(a.name)}`,
  checkout_commit: (a) => `git switch --detach ${short(a.hash)}`,
  create_branch: (a) => `git ${a.checkout ? "switch -c" : "branch"} ${quote(a.name)} ${quote(a.fromRef)}`,
  delete_branch: (a) => `git branch -D ${quote(a.name)}`,
  rename_branch: (a) => `git branch -m ${quote(a.oldName)} ${quote(a.newName)}`,
  set_upstream: (a) =>
    a.upstream ? `git branch --set-upstream-to=${quote(a.upstream)} ${quote(a.name)}` : `git branch --unset-upstream ${quote(a.name)}`,
  merge_branch: (a) => `git merge ${quote(a.branch)}`,
  abort_merge: () => "git merge --abort",
  rebase_onto: (a) => `git rebase ${quote(a.onto)}`,
  continue_rebase: () => "git rebase --continue",
  abort_rebase: () => "git rebase --abort",
  interactive_rebase: (a) =>
    `git rebase -i ${a.mode === "preserve" ? "--rebase-merges " : ""}${short(a.base)}  # ${Array.isArray(a.steps) ? a.steps.length : 0} commits`,
  continue_interactive_rebase: () => "git rebase --continue",
  abort_interactive_rebase: () => "git rebase --abort",
  reset_to: (a) => `git reset --${a.mode} ${short(a.hash)}`,
  cherry_pick: (a) => `git cherry-pick ${short(a.hash)}`,
  revert_commit: (a) => `git revert ${short(a.hash)}`,
  create_tag: (a) => join("git tag", a.message && `-a -m ${quote(firstLine(a.message))}`, quote(a.name), short(a.target)),
  delete_tag: (a) => `git tag -d ${quote(a.name)}`,

  add_remote: (a) => `git remote add ${quote(a.name)} ${quote(redactUrl(a.url))}`,
  remove_remote: (a) => `git remote remove ${quote(a.name)}`,
  clone_repository: (a) => `git clone --recurse-submodules ${quote(redactUrl(a.url))} ${quote(a.path)}`,
  update_submodules: (a) =>
    join("git submodule update --init --recursive", ...(Array.isArray(a.names) ? a.names.map(quote) : [])),
  fetch_remote: (a) => (a.remote ? `git fetch --prune ${quote(a.remote)}` : "git fetch --all --prune"),
  pull: (a) => `git pull${a.rebase ? " --rebase" : ""}`,
  push: (a) => join("git push", a.force && "--force", a.remote && quote(a.remote), a.branch && quote(a.branch)),
  delete_remote_branch: (a) => {
    const [remote, ...rest] = String(a.name).split("/");
    return `git push ${quote(remote)} --delete ${quote(rest.join("/"))}`;
  },
  rebase_pull_request: (a) => `git rebase ${quote(a.onto)} ${quote(a.branch)}  # en mémoire, copie de travail intacte`,
  force_push_pull_request: (a) =>
    `git push --force-with-lease=${quote(a.branch)}:${short(a.expected)} ${quote(a.remote)} ${quote(a.branch)}`,
  push_tag: (a) => `git push ${quote(a.remote)} ${quote(a.tag)}`,
  delete_remote_tag: (a) => `git push ${quote(a.remote)} --delete ${quote(a.tag)}`,

  lfs_pull: () => "git lfs pull",
  lfs_track: (a) => `git lfs ${a.untrack ? "untrack" : "track"} ${quote(a.pattern)}`,
};

/** Ligne de commande à journaliser pour un appel au backend, ou null s'il ne modifie rien (lecture, comptes…). */
export function describeCommand(cmd: string, args?: unknown): string | null {
  const describe = COMMANDS[cmd];
  return describe ? describe((args ?? {}) as Args) : null;
}
