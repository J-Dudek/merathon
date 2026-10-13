import { useEffect, useRef, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { confirmAction, useUiStore } from "../store/useUiStore";
import {
  branchDivergence, discardPullRequestRebase, fetchRemoteQuietly, forcePushPullRequest, rebasePullRequest,
} from "../ipc/commands";
import { runGit } from "../lib/actions";
import { plural } from "../lib/strings";
import type { LocalBranchUpdate, PrRebase } from "../types/git";
import type { PullRequestDetails } from "../types/forge";
import { Button } from "./Modal";

type SyncState =
  | { kind: "checking" }
  /** Branche introuvable ou différente de la PR (fork, fetch impossible) : pas de rebase possible ici. */
  | { kind: "unavailable"; reason: string }
  | { kind: "up_to_date" }
  | { kind: "behind"; behind: number; head: string }
  | { kind: "conflict"; behind: number; files: string[] }
  | { kind: "rebased"; head: string; result: PrRebase };

const short = (hash: string) => hash.slice(0, 7);

/** Message après le force push, selon ce qui est arrivé à la branche locale du même nom. */
function pushedMessage(branch: string, local: LocalBranchUpdate): string {
  const done = `${branch} rebasée et poussée`;
  switch (local) {
    case "updated":
      return `${done} ; la branche locale a suivi.`;
    case "diverged":
      return `${done}. La branche locale ${branch} contient d'autres commits : elle n'a pas été modifiée.`;
    case "dirty":
      return `${done}. La branche locale ${branch} est extraite avec des modifications qui seraient écrasées : elle n'a pas été mise à jour.`;
    default:
      return done;
  }
}

/**
 * Retard de la branche d'une PR sur sa cible, et mise à jour par rebase (historique linéaire) puis force push.
 * Le rebase est calculé en mémoire : la copie de travail ne bouge pas, et rien n'est poussé sans confirmation.
 */
export function PullRequestBranchSync({ details, remoteName, onCheckout, onPushed }: {
  details: PullRequestDetails;
  remoteName: string;
  onCheckout?: () => void;
  /** Branche poussée : le détail de la PR doit être rechargé. */
  onPushed: () => void;
}) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const { sourceBranch, targetBranch } = details.pr;
  const base = `${remoteName}/${targetBranch}`;
  const tracked = `${remoteName}/${sourceBranch}`;
  const [state, setState] = useState<SyncState>({ kind: "checking" });
  const [pending, setPending] = useState<"rebase" | "push" | null>(null);
  /** Rebase préparé mais pas poussé : oublié à la fermeture. */
  const prepared = useRef<{ path: string; branch: string } | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setState({ kind: "checking" });
    (async () => {
      // Refs à jour pour un retard exact ; hors ligne, on compare avec ce qui est déjà là.
      await fetchRemoteQuietly(repoPath, remoteName).catch(() => {});
      try {
        const d = await branchDivergence(repoPath, base, tracked);
        if (cancelled) return;
        if (d.head !== details.headSha) {
          setState({
            kind: "unavailable",
            reason: `${tracked} (${short(d.head)}) ne correspond pas à la tête de la PR (${short(details.headSha)}) : ` +
              "branche d'un fork, ou modifiée depuis le chargement de la PR.",
          });
        } else {
          setState(d.behind > 0 ? { kind: "behind", behind: d.behind, head: d.head } : { kind: "up_to_date" });
        }
      } catch {
        if (!cancelled) {
          setState({ kind: "unavailable", reason: `${tracked} est introuvable dans le dépôt local (branche d'un fork ?).` });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, remoteName, base, tracked, details.headSha]);

  // Fermeture du panneau sans pousser : le rebase préparé est oublié.
  useEffect(() => () => {
    const p = prepared.current;
    if (p) discardPullRequestRebase(p.path, p.branch).catch(() => {});
  }, []);

  if (!repoPath) return null;
  const path = repoPath;

  async function rebase(head: string, behind: number) {
    setPending("rebase");
    const result = await runGit(() => rebasePullRequest(path, base, head, sourceBranch), { refresh: false });
    setPending(null);
    if (!result) return;
    if (result.success) {
      prepared.current = { path, branch: sourceBranch };
      setState({ kind: "rebased", head, result });
    } else {
      setState({ kind: "conflict", behind, files: result.conflicted_files });
    }
  }

  async function cancel() {
    await discardPullRequestRebase(path, sourceBranch).catch(() => {});
    prepared.current = null;
    const d = await branchDivergence(path, base, tracked).catch(() => null);
    setState(d && d.behind > 0 ? { kind: "behind", behind: d.behind, head: d.head } : { kind: "up_to_date" });
  }

  async function forcePush(head: string, result: PrRebase) {
    const ok = await confirmAction(
      `Forcer le push de ${sourceBranch} ?`,
      `La branche distante est remplacée par la version rebasée sur ${targetBranch} (${plural(result.commits, "commit")}, historique linéaire).\n` +
        "Le push est annulé si quelqu'un a poussé sur la branche entre-temps.",
      true,
    );
    if (!ok) return;
    setPending("push");
    const pushed = await runGit(() => forcePushPullRequest(path, remoteName, sourceBranch, head), { busy: `Push de ${sourceBranch}…` });
    setPending(null);
    if (!pushed) return;
    prepared.current = null;
    const clean = pushed.local_branch === "updated" || pushed.local_branch === "absent";
    useUiStore.getState().notify(clean ? "success" : "info", pushedMessage(sourceBranch, pushed.local_branch));
    setState({ kind: "up_to_date" });
    onPushed();
  }

  return (
    <section className="flex flex-col gap-2 rounded border border-overlay/10 p-3 text-xs">
      {state.kind === "checking" && <p className="text-[var(--color-muted)] animate-pulse">Vérification du retard sur {targetBranch}…</p>}

      {state.kind === "unavailable" && (
        <p className="text-[var(--color-muted)]">Retard sur {targetBranch} non vérifiable : {state.reason}</p>
      )}

      {state.kind === "up_to_date" && <p className="text-green-300">✓ À jour avec {targetBranch}</p>}

      {state.kind === "behind" && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-amber-300">
            En retard de {plural(state.behind, "commit")} sur {targetBranch}.
          </p>
          <Button
            onClick={() => rebase(state.head, state.behind)}
            disabled={!!pending}
            title={`Rejoue les commits de ${sourceBranch} au-dessus de ${base}, sans toucher à la copie de travail`}
          >
            {pending === "rebase" ? "Rebase…" : `Rebaser sur ${targetBranch}`}
          </Button>
        </div>
      )}

      {state.kind === "conflict" && (
        <div className="flex items-start gap-3">
          <div className="flex-1 flex flex-col gap-1">
            <p className="text-red-300 font-semibold">Rebase auto impossible, merci de checkout la branche.</p>
            <p className="text-[var(--color-muted)]">
              En retard de {plural(state.behind, "commit")} sur {targetBranch}. Conflits dans :{" "}
              <span className="font-mono text-[var(--color-text)]">{state.files.join(", ")}</span>
            </p>
            <p className="text-[var(--color-muted)]">Rien n'a été modifié. Rebase la branche en local, résous les conflits, puis pousse-la.</p>
          </div>
          {onCheckout && <Button onClick={onCheckout}>Checkout</Button>}
        </div>
      )}

      {state.kind === "rebased" && (
        <div className="flex items-center gap-3">
          <div className="flex-1 flex flex-col gap-0.5">
            <p className="text-green-300">
              Rebase réussi : {plural(state.result.commits, "commit")} rejoué{state.result.commits > 1 ? "s" : ""} sur {targetBranch}.
            </p>
            <p className="text-[var(--color-muted)]">
              {state.result.skipped > 0 && `${plural(state.result.skipped, "commit")} retiré${state.result.skipped > 1 ? "s" : ""} (merge ou déjà dans la cible). `}
              Pas encore poussé : <span className="font-mono">{short(state.head)}</span> →{" "}
              <span className="font-mono">{short(state.result.new_head ?? "")}</span>
            </p>
          </div>
          <Button onClick={cancel} disabled={!!pending}>Annuler</Button>
          <Button
            variant="danger"
            onClick={() => forcePush(state.head, state.result)}
            disabled={!!pending}
            title={`git push --force-with-lease=${sourceBranch}:${short(state.head)} ${remoteName} ${sourceBranch}`}
          >
            {pending === "push" ? "Push…" : "Force push"}
          </Button>
        </div>
      )}
    </section>
  );
}
