import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { confirmAction, useUiStore } from "../store/useUiStore";
import {
  branchDivergence, discardPullRequestRebase, fetchRemoteQuietly, forcePushPullRequest, rebasePullRequest,
} from "../ipc/commands";
import { runGit } from "../lib/actions";
import { replyToPushedThreads } from "../lib/threadReplies";
import type { LocalBranchUpdate, PrRebase } from "../types/git";
import type { PullRequestDetails } from "../types/forge";
import { Button } from "./Modal";
import { tr, trn } from "../i18n";

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
  const done = tr("{branch} rebasée et poussée", { branch });
  switch (local) {
    case "updated":
      return tr("{done} ; la branche locale a suivi.", { done });
    case "diverged":
      return tr("{done}. La branche locale {branch} contient d'autres commits : elle n'a pas été modifiée.", { done, branch });
    case "dirty":
      return tr("{done}. La branche locale {branch} est extraite avec des modifications qui seraient écrasées : elle n'a pas été mise à jour.", { done, branch });
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
            reason: tr("{tracked} ({short}) ne correspond pas à la tête de la PR ({short2}) : ", { tracked, short: short(d.head), short2: short(details.headSha) }) +
              tr("branche d'un fork, ou modifiée depuis le chargement de la PR."),
          });
        } else {
          setState(d.behind > 0 ? { kind: "behind", behind: d.behind, head: d.head } : { kind: "up_to_date" });
        }
      } catch {
        if (!cancelled) {
          setState({ kind: "unavailable", reason: tr("{tracked} est introuvable dans le dépôt local (branche d'un fork ?).", { tracked }) });
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
      tr("Forcer le push de {sourceBranch} ?", { sourceBranch }),
      tr("La branche distante est remplacée par la version rebasée sur {targetBranch} ({count}, historique linéaire).\n", { targetBranch, count: trn(result.commits, "{n} commit", "{n} commits") }) +
        tr("Le push est annulé si quelqu'un a poussé sur la branche entre-temps."),
      true,
    );
    if (!ok) return;
    setPending("push");
    const pushed = await runGit(() => forcePushPullRequest(path, remoteName, sourceBranch, head), { busy: tr("Push de {sourceBranch}…", { sourceBranch }) });
    setPending(null);
    if (!pushed) return;
    prepared.current = null;
    const clean = pushed.local_branch === "updated" || pushed.local_branch === "absent";
    useUiStore.getState().notify(clean ? "success" : "info", pushedMessage(sourceBranch, pushed.local_branch));
    setState({ kind: "up_to_date" });
    // Avant le rechargement de la PR, pour qu'il montre les réponses.
    await replyToPushedThreads(path, { remote: remoteName, branch: sourceBranch, from: head, to: pushed.new_head }, details.pr.number);
    onPushed();
  }

  return (
    <section className="flex flex-col gap-2 rounded border border-overlay/10 p-3 text-xs">
      {state.kind === "checking" && <p className="text-[var(--color-muted)]">{tr("Vérification du retard sur {targetBranch}…", { targetBranch })}</p>}

      {state.kind === "unavailable" && (
        <p className="text-[var(--color-muted)]">{tr("Retard sur {targetBranch} non vérifiable : {reason}", { targetBranch, reason: state.reason })}</p>
      )}

      {state.kind === "up_to_date" && <p className="text-green-300"><Check size={12} className="inline mr-1 -mt-0.5" />{tr("À jour avec {targetBranch}", { targetBranch })}</p>}

      {state.kind === "behind" && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-amber-300">
            {tr("En retard de {count} sur {targetBranch}.", { count: trn(state.behind, "{n} commit", "{n} commits"), targetBranch })}
          </p>
          <Button
            onClick={() => rebase(state.head, state.behind)}
            disabled={!!pending}
            title={tr("Rejoue les commits de {sourceBranch} au-dessus de {base}, sans toucher à la copie de travail", { sourceBranch, base })}
          >
            {pending === "rebase" ? tr("Rebase…") : tr("Rebaser sur {targetBranch}", { targetBranch })}
          </Button>
        </div>
      )}

      {state.kind === "conflict" && (
        <div className="flex items-start gap-3">
          <div className="flex-1 flex flex-col gap-1">
            <p className="text-red-300 font-semibold">{tr("Rebase auto impossible, merci de checkout la branche.")}</p>
            <p className="text-[var(--color-muted)]">
              {tr("En retard de {count} sur {targetBranch}. Conflits dans :", { count: trn(state.behind, "{n} commit", "{n} commits"), targetBranch })}
              <span className="font-mono text-[var(--color-text)]">{state.files.join(", ")}</span>
            </p>
            <p className="text-[var(--color-muted)]">{tr("Rien n'a été modifié. Rebase la branche en local, résous les conflits, puis pousse-la.")}</p>
          </div>
          {onCheckout && <Button onClick={onCheckout}>Checkout</Button>}
        </div>
      )}

      {state.kind === "rebased" && (
        <div className="flex items-center gap-3">
          <div className="flex-1 flex flex-col gap-0.5">
            <p className="text-green-300">
              {trn(state.result.commits, "Rebase réussi : {n} commit rejoué sur {targetBranch}.", "Rebase réussi : {n} commits rejoués sur {targetBranch}.", { targetBranch })}
            </p>
            <p className="text-[var(--color-muted)]">
              {state.result.skipped > 0 && `${trn(state.result.skipped, "{n} commit retiré (merge ou déjà dans la cible).", "{n} commits retirés (merge ou déjà dans la cible).")} `}
              {tr("Pas encore poussé :")}{" "}<span className="font-mono">{short(state.head)}</span> →{" "}
              <span className="font-mono">{short(state.result.new_head ?? "")}</span>
            </p>
          </div>
          <Button onClick={cancel} disabled={!!pending}>{tr("Annuler")}</Button>
          <Button
            variant="danger"
            onClick={() => forcePush(state.head, state.result)}
            disabled={!!pending}
            title={`git push --force-with-lease=${sourceBranch}:${short(state.head)} ${remoteName} ${sourceBranch}`}
          >
            {pending === "push" ? tr("Push…") : "Force push"}
          </Button>
        </div>
      )}
    </section>
  );
}
