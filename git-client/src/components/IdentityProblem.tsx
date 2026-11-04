import { TriangleAlert } from "lucide-react";
import { clearLocalIdentity } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { identityIssue } from "../lib/gitProfiles";
import { useRepoStore } from "../store/useRepoStore";
import { confirmAction, useUiStore } from "../store/useUiStore";
import { tr } from "../i18n";

/** Alerte quand les commits du dépôt ne seraient pas signés avec l'e-mail de son profil. Rien n'est modifié sans confirmation. */
export function IdentityProblem() {
  const repoPath = useRepoStore((s) => s.repoPath);
  const status = useRepoStore((s) => s.identity);
  const issue = identityIssue(status);
  if (!issue || !repoPath) return null;

  async function useProfile() {
    if (!repoPath || !status?.profile) return;
    const ok = await confirmAction(
      tr("Utiliser l'identité du profil ?"),
      tr("Le nom et l'e-mail propres à ce dépôt seront retirés. Ses prochains commits seront signés {user_email}. Les commits existants ne changent pas.", { user_email: status.profile.user_email }),
    );
    if (!ok) return;
    try {
      await clearLocalIdentity(repoPath);
      await useRepoStore.getState().refresh();
    } catch (e) {
      useUiStore.getState().notify("error", errorMessage(e));
    }
  }

  return (
    <div role="alert" className="flex items-start gap-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-[var(--color-text)]">
      <TriangleAlert size={13} className="shrink-0 mt-0.5 text-amber-300" aria-hidden />
      <div className="min-w-0">
        <p className="break-words">{issue.message}</p>
        {issue.canUseProfile && (
          <button className="mt-1 underline hover:opacity-80" onClick={useProfile}>{tr("Utiliser le profil")}</button>
        )}
      </div>
    </div>
  );
}
