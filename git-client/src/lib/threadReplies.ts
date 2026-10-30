import { commitTrailers, push } from "../ipc/commands";
import { useAccountsStore } from "../store/useAccountsStore";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import { errorMessage, runGit } from "./actions";
import { remoteForAccount } from "./remoteUrl";
import { planThreadReplies, threadLinksOf, threadReplyBody, type ThreadReplyPlan } from "./threadTrailers";
import type { ForgeClient } from "../api/forge";
import type { ForgeAccount } from "../types/forge";

/** Commits arrivés sur `remote/branch` par un push : `from` est l'ancienne tête distante. */
export interface PushedRange {
  remote: string;
  branch: string;
  from: string;
  to: string;
}

/** Compte dont l'instance héberge le remote poussé, et chemin du projet. */
function forgeOfRemote(remoteName: string): { account: ForgeAccount; projectPath: string } | null {
  const remotes = useRepoStore.getState().remotes.filter((r) => r.name === remoteName);
  for (const account of useAccountsStore.getState().accounts) {
    const match = remoteForAccount(remotes, account);
    if (match) return { account, projectPath: match.path };
  }
  return null;
}

/** PR ouverte de la branche poussée ; avec plusieurs PR de même branche source (forks), celle qui a reçu ce push. */
async function pushedPullRequest(client: ForgeClient, projectPath: string, range: PushedRange): Promise<number | undefined> {
  const prs = (await client.getPullRequests(projectPath, "open")).filter((pr) => pr.sourceBranch === range.branch);
  return (prs.find((pr) => pr.headSha === range.to) ?? prs[0])?.number;
}

/** Publie réponses et résolutions ; un fil en échec n'empêche pas les suivants. Renvoie les erreurs. */
async function publish(client: ForgeClient, projectPath: string, number: number, plans: ThreadReplyPlan[]): Promise<string[]> {
  const errors: string[] = [];
  for (const plan of plans) {
    try {
      if (plan.hashes.length) await client.replyToThread(projectPath, number, plan.thread, threadReplyBody(plan.hashes));
      if (plan.resolve) await client.resolveThread(projectPath, number, plan.thread, true);
    } catch (e) {
      errors.push(`${plan.thread.path} : ${errorMessage(e)}`);
    }
  }
  return errors;
}

/**
 * Répond aux fils de revue cités en trailers par les commits poussés, et résout ceux qui le demandent.
 * Aucune requête vers la forge si aucun commit poussé n'a de trailer. Un échec n'est qu'un avertissement : le push a eu lieu.
 * `prNumber` évite de chercher la PR quand l'appelant la connaît.
 */
export async function replyToPushedThreads(path: string, range: PushedRange, prNumber?: number): Promise<void> {
  const notify = useUiStore.getState().notify;
  try {
    if (range.from === range.to) return;
    const commits = await commitTrailers(path, range.from, range.to);
    if (!commits.some((c) => Object.keys(threadLinksOf(c.trailers)).length)) return;
    const forge = forgeOfRemote(range.remote);
    if (!forge) return;
    const client = await useAccountsStore.getState().client(forge.account);
    const number = prNumber ?? await pushedPullRequest(client, forge.projectPath, range);
    if (number === undefined) return;

    const plans = planThreadReplies(commits, await client.getReviewThreads(forge.projectPath, number));
    if (!plans.length) return;
    const errors = await publish(client, forge.projectPath, number, plans);
    const done = plans.length - errors.length;
    const ref = forge.account.provider === "github" ? `#${number}` : `!${number}`;
    const threads = done > 1 ? `${done} fils` : "1 fil";
    if (done) notify("success", `${threads} de revue mis à jour sur ${ref}`);
    if (errors.length) notify("error", `Fils de revue non mis à jour sur ${ref} : ${errors.join(" ; ")}`);
  } catch (e) {
    notify("error", `Réponses aux fils de revue impossibles : ${errorMessage(e)}`);
  }
}

/**
 * Push d'une branche locale vers son remote de suivi, puis réponses aux fils de revue cités par les commits poussés.
 * Une branche pas encore suivie n'a pas de PR : seul le push a lieu.
 */
export async function pushBranch(path: string, branch: string, opts: { force?: boolean; success: string }): Promise<void> {
  const { branches } = useRepoStore.getState();
  const upstream = branches.find((b) => !b.is_remote && b.name === branch)?.upstream;
  const remote = upstream?.slice(0, upstream.indexOf("/"));
  const tracking = (name: string) => useRepoStore.getState().branches.find((b) => b.is_remote && b.name === name)?.target_hash;
  const before = remote ? tracking(`${remote}/${branch}`) : undefined;

  const pushed = await runGit(() => push(path, { branch, force: opts.force }).then(() => true), { busy: "Push…", success: opts.success });
  if (!pushed || !remote || !before) return;
  const after = tracking(`${remote}/${branch}`);
  if (after) await replyToPushedThreads(path, { remote, branch, from: before, to: after });
}
