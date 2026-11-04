import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import type { InteractiveOutcome, MergeResult } from "../types/git";
import { tr, trn } from "../i18n";

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  // Objet d'erreur sans prototype Error (rejet d'un plugin, réponse brute) : son message plutôt que « [object Object] ».
  if (e && typeof e === "object") {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
    try {
      return JSON.stringify(e);
    } catch {
      // structure circulaire : repli ci-dessous
    }
  }
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
    ui.notify("info", trn(n, "Opération interrompue : {n} fichier en conflit à résoudre dans le panneau de droite", "Opération interrompue : {n} fichiers en conflit à résoudre dans le panneau de droite"));
  }
}

/** Notifie l'issue d'un rebase interactif (terminé, ou arrêté sur un conflit / un commit à modifier). */
export function reportInteractive(outcome: InteractiveOutcome | undefined) {
  if (!outcome) return;
  const ui = useUiStore.getState();
  const stop = outcome.stopped;
  if (!stop) {
    ui.notify("success", tr("Rebase interactif terminé (ancienne position : ORIG_HEAD)"));
    return;
  }
  useRepoStore.getState().setSelectedCommit(null);
  ui.notify(
    "info",
    stop.reason === "conflict"
      ? tr("Rebase interactif en pause : conflit en appliquant {short_hash} « {summary} ». Résous-le puis clique sur Continuer.", { short_hash: stop.short_hash, summary: stop.summary })
      : tr("Rebase interactif en pause sur {short_hash} « {summary} » : modifie-le puis clique sur Continuer.", { short_hash: stop.short_hash, summary: stop.summary }),
  );
}
