import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import type { InteractiveOutcome, MergeResult } from "../types/git";

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

interface RunOptions {
  /** Libellé affiché pendant une opération longue (désactive les autres opérations réseau). */
  busy?: string;
  /** Notification affichée en cas de succès. */
  success?: string;
  /** Rafraîchit le dépôt après l'opération (par défaut : oui). */
  refresh?: boolean;
}

/** Exécute une opération git : erreurs notifiées, état "occupé", puis rafraîchissement du dépôt. */
export async function runGit<T>(fn: () => Promise<T>, opts: RunOptions = {}): Promise<T | undefined> {
  const ui = useUiStore.getState();
  if (opts.busy) ui.setBusy(opts.busy);
  try {
    const result = await fn();
    if (opts.success) ui.notify("success", opts.success);
    return result;
  } catch (e) {
    ui.notify("error", errorMessage(e));
    return undefined;
  } finally {
    if (opts.busy) ui.setBusy(null);
    if (opts.refresh !== false) {
      await useRepoStore.getState().refresh().catch((e) => ui.notify("error", errorMessage(e)));
    }
  }
}

/**
 * Notifie l'issue d'un merge / rebase / cherry-pick / revert / pull.
 * En cas de conflit, affiche le panneau de staging où se trouvent les fichiers à résoudre.
 */
export function reportMerge(result: MergeResult | undefined, successLabel: string) {
  if (!result) return;
  const ui = useUiStore.getState();
  if (result.success) {
    ui.notify("success", successLabel);
  } else {
    const n = result.conflicted_files.length;
    useRepoStore.getState().setSelectedCommit(null);
    ui.notify("info", `Opération interrompue : ${n} fichier${n > 1 ? "s" : ""} en conflit à résoudre dans le panneau de droite`);
  }
}

/** Notifie l'issue d'un rebase interactif (terminé, ou arrêté sur un conflit / un commit à modifier). */
export function reportInteractive(outcome: InteractiveOutcome | undefined) {
  if (!outcome) return;
  const ui = useUiStore.getState();
  const stop = outcome.stopped;
  if (!stop) {
    ui.notify("success", "Rebase interactif terminé (ancienne position : ORIG_HEAD)");
    return;
  }
  useRepoStore.getState().setSelectedCommit(null);
  ui.notify(
    "info",
    stop.reason === "conflict"
      ? `Rebase interactif en pause : conflit en appliquant ${stop.short_hash} « ${stop.summary} ». Résous-le puis clique sur Continuer.`
      : `Rebase interactif en pause sur ${stop.short_hash} « ${stop.summary} » : modifie-le puis clique sur Continuer.`,
  );
}
