import { GitHubClient } from "./github";
import { GitLabClient } from "./gitlab";
import { forgeApi, forgeApiSend, forgeGraphql } from "../ipc/commands";
import type {
  CreatedPullRequest, ForgeAccount, ForgeComment, ForgeIssue, ForgePR, ForgeRepo, LinePosition, MergeOptions, MyPullRequests, NewPullRequest, PrTemplates,
  PullRequestDetails, PullRequestOptions, PullRequestState, ReviewContext, ReviewEvent, ReviewSubmission, ReviewThread,
  SubmittedReview,
} from "../types/forge";

/** Interface commune GitHub / GitLab. `projectPath` = "owner/repo" ou "group/sub/repo". */
export interface ForgeClient {
  getCurrentUser(): Promise<string>;
  listRepos(): Promise<ForgeRepo[]>;
  getPullRequests(projectPath: string, state?: PullRequestState): Promise<ForgePR[]>;
  /** PR / MR ouvertes de tous les projets : à traiter et ouvertes par moi. */
  getMyPullRequests(): Promise<MyPullRequests>;
  /** Une PR / MR ; sur GitHub, seule cette requête donne le nombre de commentaires. */
  getPullRequest(projectPath: string, number: number): Promise<ForgePR>;
  getIssues(projectPath: string): Promise<ForgeIssue[]>;
  /** Branche par défaut, membres, labels, jalons du projet pour le formulaire de création. */
  getPullRequestOptions(projectPath: string): Promise<PullRequestOptions>;
  /** Modèles de description du projet, pour pré-remplir le formulaire de création. */
  getPullRequestTemplates(projectPath: string): Promise<PrTemplates>;
  /** Crée une pull request (GitHub) / merge request (GitLab). */
  createPullRequest(projectPath: string, input: NewPullRequest): Promise<CreatedPullRequest>;
  /** Description, relectures, CI et mergeabilité d'une PR / MR. */
  getPullRequestDetails(projectPath: string, number: number): Promise<PullRequestDetails>;
  getComments(projectPath: string, number: number): Promise<ForgeComment[]>;
  addComment(projectPath: string, number: number, body: string): Promise<void>;
  /** Avis de relecture ; `body` accompagne l'avis (obligatoire pour une demande de changements sur GitHub). */
  review(projectPath: string, number: number, event: ReviewEvent, body: string): Promise<void>;
  merge(projectPath: string, number: number, options: MergeOptions): Promise<void>;
  setState(projectPath: string, number: number, state: "open" | "closed"): Promise<void>;
  /** Passe la PR / MR en brouillon ou la marque prête pour la relecture. */
  setDraft(projectPath: string, number: number, draft: boolean): Promise<void>;
  /** Fils de commentaires attachés aux lignes du diff. */
  getReviewThreads(projectPath: string, number: number): Promise<ReviewThread[]>;
  /** Publie immédiatement un commentaire sur une ligne du diff. */
  addLineComment(projectPath: string, number: number, ctx: ReviewContext, position: LinePosition, body: string): Promise<void>;
  replyToThread(projectPath: string, number: number, thread: ReviewThread, body: string): Promise<void>;
  resolveThread(projectPath: string, number: number, thread: ReviewThread, resolved: boolean): Promise<void>;
  /** Publie une revue : commentaires de ligne préparés, commentaire général et avis. */
  submitReview(projectPath: string, number: number, ctx: ReviewContext, review: ReviewSubmission): Promise<SubmittedReview>;
  /** Met la branche source à jour avec la cible : merge (GitHub) ou rebase (GitLab), côté forge. */
  updateBranch(projectPath: string, number: number, sha: string): Promise<void>;
}

/** Client d'API d'un compte : les requêtes passent par le backend, qui seul détient le token. */
export function forgeClient(account: ForgeAccount): ForgeClient {
  const get = <T,>(path: string) => forgeApi(account.id, path) as Promise<T>;
  const send = <T,>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown) =>
    forgeApiSend(account.id, method, path, body) as Promise<T>;
  if (account.provider === "github") {
    const graphql = <T,>(query: string, variables: Record<string, unknown>) =>
      forgeGraphql(account.id, query, variables) as Promise<T>;
    const client = new GitHubClient(get, send, graphql);
    const split = (path: string) => {
      const [owner, repo] = path.split("/");
      return [owner, repo] as const;
    };
    return {
      getCurrentUser: () => client.getCurrentUser(),
      listRepos: () => client.listRepos(),
      getPullRequests: (path, state) => client.getPullRequests(...split(path), state),
      getPullRequest: (path, n) => client.getPullRequest(...split(path), n),
      getMyPullRequests: () => client.getMyPullRequests(),
      getIssues: (path) => client.getIssues(...split(path)),
      getPullRequestOptions: (path) => client.getPullRequestOptions(...split(path)),
      getPullRequestTemplates: (path) => client.getPullRequestTemplates(...split(path)),
      createPullRequest: (path, input) => client.createPullRequest(...split(path), input),
      getPullRequestDetails: (path, n) => client.getPullRequestDetails(...split(path), n, account.username),
      getComments: (path, n) => client.getComments(...split(path), n),
      addComment: (path, n, body) => client.addComment(...split(path), n, body),
      review: (path, n, event, body) => client.review(...split(path), n, event, body),
      merge: (path, n, options) => client.merge(...split(path), n, options),
      setState: (path, n, state) => client.setState(...split(path), n, state),
      updateBranch: (path, n, sha) => client.updateBranch(...split(path), n, sha),
      setDraft: (path, n, draft) => client.setDraft(...split(path), n, draft),
      getReviewThreads: (path, n) => client.getReviewThreads(...split(path), n),
      addLineComment: (path, n, ctx, pos, body) => client.addLineComment(...split(path), n, ctx, pos, body),
      replyToThread: (path, n, thread, body) => client.replyToThread(...split(path), n, thread.replyTo, body),
      resolveThread: (_path, _n, thread, resolved) => client.resolveThread(thread.id, resolved),
      submitReview: (path, n, ctx, review) => client.submitReview(...split(path), n, ctx, review),
    };
  }
  const client = new GitLabClient(get, send);
  return {
    getCurrentUser: () => client.getCurrentUser(),
    listRepos: () => client.listRepos(),
    getPullRequests: (path, state) => client.getMergeRequests(path, state),
    getPullRequest: (path, n) => client.getMergeRequest(path, n),
    getMyPullRequests: () => client.getMyMergeRequests(account.username),
    getIssues: (path) => client.getIssues(path),
    getPullRequestOptions: (path) => client.getMergeRequestOptions(path),
    getPullRequestTemplates: (path) => client.getMergeRequestTemplates(path),
    createPullRequest: (path, input) => client.createMergeRequest(path, input),
    getPullRequestDetails: (path, n) => client.getMergeRequestDetails(path, n, account.username),
    getComments: (path, n) => client.getComments(path, n),
    addComment: (path, n, body) => client.addComment(path, n, body),
    review: (path, n, event, body) => client.review(path, n, event, body),
    merge: (path, n, options) => client.merge(path, n, options),
    setState: (path, n, state) => client.setState(path, n, state),
    updateBranch: (path, n) => client.rebase(path, n),
    setDraft: (path, n, draft) => client.setDraft(path, n, draft),
    getReviewThreads: (path, n) => client.getReviewThreads(path, n),
    addLineComment: (path, n, ctx, pos, body) => client.addLineComment(path, n, ctx, pos, body),
    replyToThread: (path, n, thread, body) => client.replyToThread(path, n, thread.replyTo, body),
    resolveThread: (path, n, thread, resolved) => client.resolveThread(path, n, thread.id, resolved),
    submitReview: (path, n, ctx, review) => client.submitReview(path, n, ctx, review),
  };
}
