import { addWorktree, getStatus, removeWorktree } from "../ipc/commands";
import { useRepoStore } from "../store/useRepoStore";
import { samePath, tabPath, useTabsStore } from "../store/useTabsStore";
import { confirmAction, promptText } from "../store/useUiStore";
import { runGit } from "./actions";
import { openRepoAt } from "./repoActions";
import { trimEndChars } from "./strings";
import type { WorktreeInfo } from "../types/git";
import { tr } from "../i18n";

/** Dossier proposé pour un worktree : à côté du worktree principal, `<dépôt>-<branche>`. */
export function defaultWorktreePath(mainPath: string, branch: string): string {
  const main = trimEndChars(mainPath, "\\/");
  const slug = branch.replace(/[\\/:*?"<>|\s]+/g, "-");
  return `${main}-${slug}`;
}

/** Demande l'emplacement, crée le worktree (et la branche si `create`) puis l'ouvre dans un onglet. */
export async function createWorktree(branch: string, create: boolean) {
  const { repoPath, worktrees } = useRepoStore.getState();
  if (!repoPath) return;
  const main = worktrees.find((w) => w.is_main)?.path ?? repoPath;
  const target = await promptText(tr("Worktree pour {branch}", { branch }), {
    initial: defaultWorktreePath(main, branch),
    message: tr("Dossier à créer (chemin absolu)"),
  });
  if (!target) return;
  const created = await runGit(() => addWorktree(repoPath, target, branch, create).then(() => true), {
    busy: tr("Création du worktree…"),
    success: tr("Worktree {branch} créé", { branch }),
  });
  if (created) await openRepoAt(target);
}

function lostFiles(n: number): string {
  return n > 1
    ? tr("{n} fichiers modifiés ou non suivis seront définitivement perdus.", { n })
    : tr("1 fichier modifié ou non suivi sera définitivement perdu.");
}

/** Message de confirmation : ce qui disparaît avec le worktree. */
export function removalMessage(w: WorktreeInfo, changes: number): string {
  if (!w.valid) return tr("Le dossier {path} est introuvable : seule sa référence dans le dépôt sera retirée.", { path: w.path });
  const kept = w.branch ? tr(" La branche {branch} est conservée.", { branch: w.branch }) : "";
  const lost = changes > 0 ? `${lostFiles(changes)} ` : "";
  return tr("{lost}Le dossier {path} et tout son contenu seront supprimés.{kept}", { lost, path: w.path, kept });
}

/** Supprime un worktree lié après confirmation et ferme son onglet. */
export async function deleteWorktree(w: WorktreeInfo) {
  const { repoPath } = useRepoStore.getState();
  if (!repoPath || !w.name) return;
  const name = w.name;
  const changes = w.valid ? (await getStatus(w.path).catch(() => [])).length : 0;
  if (!(await confirmAction(tr("Supprimer le worktree « {name} » ?", { name }), removalMessage(w, changes), true))) return;
  const removed = await runGit(() => removeWorktree(repoPath, name).then(() => true), {
    busy: tr("Suppression du worktree…"),
    success: tr("Worktree {name} supprimé", { name }),
  });
  if (!removed) return;
  // Le dossier n'existe plus : il ne doit pas rester proposé dans les dépôts récents.
  const { recentRepos, forgetRecent } = useRepoStore.getState();
  recentRepos.filter((p) => samePath(p, w.path)).forEach(forgetRecent);
  const { tabs, activeId, closeTab } = useTabsStore.getState();
  const tab = tabs.find((t) => samePath(tabPath(t, activeId), w.path));
  if (tab) closeTab(tab.id);
}
