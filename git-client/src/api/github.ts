import type {
  CreatedPullRequest, ForgeCheck, ForgeComment, ForgeIssue, ForgeLabel, ForgeMilestone, ForgePR, ForgeRepo, ForgeUser,
  LinePosition, MergeMethod, MergeOptions, MyPullRequests, NewPullRequest, PrSummary, PrTemplate, PrTemplates, PullRequestDetails, PullRequestEdit, PullRequestOptions, PullRequestPeople, PullRequestState,
  ReviewContext, ReviewEvent, ReviewSubmission, ReviewThread, SubmittedReview,
} from "../types/forge";
import { PR_PAGE_SIZE } from "../types/forge";
import { errorMessage } from "../lib/actions";

/** GET sur l'API du compte (chemin relatif). La requête et le token sont gérés côté Rust. */
export type ApiGet = <T>(path: string) => Promise<T>;
/** Requête d'écriture sur l'API du compte, avec corps JSON. */
export type ApiSend = <T>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown) => Promise<T>;

/** Requête GraphQL sur l'instance du compte ; renvoie le champ `data`. */
export type ApiGraphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

const noSend: ApiSend = () => Promise.reject(new Error("Écriture non disponible"));
const noGraphql: ApiGraphql = () => Promise.reject(new Error("GraphQL non disponible"));

const seg = (value: string) => encodeURIComponent(value);

// Champs lus dans les réponses de l'API GitHub (le reste est ignoré).
interface RawUser {
  id?: number;
  login: string;
  /** Nom complet : seulement dans le profil (`/users/{login}`), pas dans les listes. */
  name?: string | null;
}

interface RawLabel {
  name: string;
  color?: string;
}

interface RawMilestone {
  number: number;
  title: string;
}

interface RawRepo {
  name: string;
  full_name: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  description: string | null;
  updated_at: string;
}

interface RawIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  user: RawUser | null;
  html_url: string;
  created_at: string;
  updated_at?: string;
  labels?: RawLabel[];
  /** Présent quand l'« issue » est en fait une pull request. */
  pull_request?: unknown;
}

interface RawPullRequest extends RawIssue {
  /** Identifiant GraphQL. */
  node_id?: string;
  merged_at: string | null;
  draft?: boolean;
  head?: { ref: string; sha?: string };
  base?: { ref: string };
  requested_reviewers?: RawUser[];
  assignees?: RawUser[];
  body?: string | null;
  /** null tant que GitHub calcule la mergeabilité. */
  mergeable?: boolean | null;
  mergeable_state?: string;
  /** Commentaires de conversation et de ligne : seulement dans le détail d'une PR, pas dans la liste. */
  comments?: number;
  review_comments?: number;
}

interface RawRepoSettings {
  allow_merge_commit?: boolean;
  allow_squash_merge?: boolean;
  allow_rebase_merge?: boolean;
  permissions?: { push?: boolean };
}

interface RawReview {
  id: number;
  user: RawUser | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string | null;
  submitted_at?: string;
}

interface RawComment {
  id: number;
  user: RawUser | null;
  body: string;
  created_at: string;
}

interface RawCheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: string | null;
  html_url: string | null;
}

interface RawStatus {
  context: string;
  state: "pending" | "success" | "failure" | "error";
  target_url: string | null;
}

/** PR lue par la recherche GraphQL (les résultats qui ne sont pas des PR arrivent vides). */
interface RawSearchPullRequest {
  number?: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string }[] };
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] };
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  latestOpinionatedReviews: { nodes: { state: string }[] };
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null; committer?: { user: { login: string } | null } | null } }[] };
}

const SEARCH_FIELDS = `
  ... on PullRequest {
    number title url createdAt updatedAt isDraft headRefName baseRefName headRefOid
    author { login }
    repository { nameWithOwner }
    labels(first: 20) { nodes { name } }
    assignees(first: 20) { nodes { login } }
    reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
    reviewDecision
    latestOpinionatedReviews(first: 20) { nodes { state } }
    mergeable
    commits(last: 1) { nodes { commit { statusCheckRollup { state } committer { user { login } } } } }
  }`;

const MY_PRS_QUERY = `query($assigned: String!, $reviewing: String!, $authored: String!) {
  viewer { login }
  assigned: search(query: $assigned, type: ISSUE, first: ${PR_PAGE_SIZE}) { nodes { ${SEARCH_FIELDS} } }
  reviewing: search(query: $reviewing, type: ISSUE, first: ${PR_PAGE_SIZE}) { nodes { ${SEARCH_FIELDS} } }
  authored: search(query: $authored, type: ISSUE, first: ${PR_PAGE_SIZE}) { nodes { ${SEARCH_FIELDS} } }
}`;

/** Avis de relecture d'une PR, tels que GraphQL les donne. */
type RawReviewState = Pick<RawSearchPullRequest, "reviewDecision" | "latestOpinionatedReviews">;

/** La liste REST des PR ne donne pas les relectures : elles sont lues à part, dans le même ordre (création). */
const OPEN_REVIEWS_QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: ${PR_PAGE_SIZE}, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { number reviewDecision latestOpinionatedReviews(first: 20) { nodes { state } } }
    }
  }
}`;

/** Explication de `mergeable_state` (https://docs.github.com/rest/pulls/pulls). */
const MERGE_STATES: Record<string, string> = {
  clean: "Prête à merger",
  has_hooks: "Prête à merger",
  unstable: "Mergeable, mais des checks non obligatoires échouent",
  blocked: "Bloquée : relectures ou checks obligatoires manquants",
  behind: "En retard sur la branche cible : à mettre à jour",
  dirty: "Conflits avec la branche cible",
  draft: "Brouillon : à passer en « prête » sur GitHub avant le merge",
};

export class GitHubClient {
  constructor(private get: ApiGet, private send: ApiSend = noSend, private graphql: ApiGraphql = noGraphql) {}

  /** Valide le token et renvoie le login associé. */
  async getCurrentUser(): Promise<string> {
    const user = await this.get<RawUser>("/user");
    return user.login;
  }

  async listRepos(): Promise<ForgeRepo[]> {
    const data = await this.get<RawRepo[]>(
      "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
    );
    return data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      cloneUrl: r.clone_url,
      sshUrl: r.ssh_url,
      private: r.private,
      description: r.description ?? "",
      updatedAt: r.updated_at,
    }));
  }

  /** GitHub ne filtre pas les PR mergées : elles sont extraites des PR fermées. */
  async getPullRequests(owner: string, repo: string, state: PullRequestState = "open"): Promise<ForgePR[]> {
    const query = state === "merged" ? "closed" : state;
    const data = await this.get<RawPullRequest[]>(`/repos/${seg(owner)}/${seg(repo)}/pulls?state=${query}&per_page=${PR_PAGE_SIZE}`);
    const prs = data.map(parsePR);
    if (state === "merged") return prs.filter((p) => p.state === "merged");
    if (state === "closed") return prs.filter((p) => p.state === "closed");
    if (!prs.some((p) => p.state === "open")) return prs;
    const approved = await this.getApprovedPullRequests(owner, repo).catch(() => null);
    return approved ? prs.map((p) => (p.state === "open" ? { ...p, approved: approved.has(p.number) } : p)) : prs;
  }

  /** Numéros des PR ouvertes dont la relecture est approuvée. */
  private async getApprovedPullRequests(owner: string, repo: string): Promise<Set<number>> {
    type Node = RawReviewState & { number: number };
    const data = await this.graphql<{ repository: { pullRequests: { nodes: Node[] } } | null }>(OPEN_REVIEWS_QUERY, { owner, repo });
    const nodes = data.repository?.pullRequests.nodes ?? [];
    return new Set(nodes.filter((n) => reviewState(n) === "approved").map((n) => n.number));
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<ForgePR> {
    return parsePR(await this.get<RawPullRequest>(`/repos/${seg(owner)}/${seg(repo)}/pulls/${number}`));
  }

  /** PR ouvertes de tous les dépôts : assignées, relecture demandée (fusionnées sans doublon) et ouvertes par moi. */
  async getMyPullRequests(): Promise<MyPullRequests> {
    const open = "is:pr is:open archived:false";
    type Result = { nodes: RawSearchPullRequest[] };
    const data = await this.graphql<{ viewer?: { login: string }; assigned: Result; reviewing: Result; authored: Result }>(MY_PRS_QUERY, {
      assigned: `${open} assignee:@me`,
      reviewing: `${open} review-requested:@me`,
      authored: `${open} author:@me`,
    });
    const parse = (r: Result) => r.nodes.filter((n) => n.number !== undefined).map((n) => parseSearchPR(n, data.viewer?.login));
    return { assigned: uniquePrs([...parse(data.assigned), ...parse(data.reviewing)]), authored: parse(data.authored) };
  }

  /** Les checks sont facultatifs : un token sans accès aux checks n'empêche pas d'afficher la PR. */
  async getPullRequestDetails(owner: string, repo: string, number: number, me: string): Promise<PullRequestDetails> {
    const base = `/repos/${seg(owner)}/${seg(repo)}`;
    const [raw, settings, reviews] = await Promise.all([
      this.get<RawPullRequest>(`${base}/pulls/${number}`),
      this.get<RawRepoSettings>(base),
      this.get<RawReview[]>(`${base}/pulls/${number}/reviews?per_page=100`),
    ]);
    const sha = raw.head?.sha ?? "";
    const [runs, statuses] = sha
      ? await Promise.all([
        this.get<{ check_runs: RawCheckRun[] }>(`${base}/commits/${sha}/check-runs?per_page=100`).catch(() => ({ check_runs: [] })),
        this.get<{ statuses: RawStatus[] }>(`${base}/commits/${sha}/status`).catch(() => ({ statuses: [] })),
      ])
      : [{ check_runs: [] }, { statuses: [] }];

    // Dernier avis de chaque relecteur ; un simple commentaire ne remplace pas une approbation.
    const verdicts = new Map<string, RawReview["state"]>();
    for (const r of reviews) {
      if (r.user && (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED" || r.state === "DISMISSED")) verdicts.set(r.user.login, r.state);
    }
    const withVerdict = (state: RawReview["state"]) => [...verdicts].filter(([, s]) => s === state).map(([login]) => login);

    const pr = parsePR(raw);
    // L'API ne donne que les logins : le nom complet vient du profil de chacun, facultatif.
    const people = [...new Set([...pr.reviewers, ...pr.assignees, ...verdicts.keys()])];
    const profiles = await Promise.all(people.map((login) => this.get<RawUser>(`/users/${seg(login)}`).catch(() => null)));
    const names: Record<string, string> = {};
    people.forEach((login, i) => {
      const name = profiles[i]?.name;
      if (name) names[login] = name;
    });

    const methods: MergeMethod[] = [];
    if (settings.allow_merge_commit !== false) methods.push("merge");
    if (settings.allow_squash_merge !== false) methods.push("squash");
    if (settings.allow_rebase_merge !== false) methods.push("rebase");

    const mergeState = raw.mergeable_state ?? "unknown";
    const canPush = settings.permissions?.push !== false;
    const mergeable = pr.state === "open"
      && canPush
      && raw.mergeable === true
      && ["clean", "has_hooks", "unstable"].includes(mergeState);
    // Exigences de la branche non remplies, sans conflit : seul GraphQL dit si mes droits permettent de passer outre.
    const blocked = pr.state === "open" && canPush && raw.mergeable === true && ["blocked", "behind"].includes(mergeState);
    const canForceMerge = blocked && await this.canMergeAsAdmin(owner, repo, number).catch(() => false);

    return {
      pr,
      description: raw.body ?? "",
      headSha: sha,
      approvedBy: withVerdict("APPROVED"),
      changesRequestedBy: withVerdict("CHANGES_REQUESTED"),
      approvedByMe: verdicts.get(me) === "APPROVED",
      names,
      approvalsLeft: null,
      checks: [...runs.check_runs.map(parseCheckRun), ...statuses.statuses.map(parseStatus)],
      mergeable,
      mergeStatus: describeMergeState(pr, raw, settings),
      canForceMerge,
      canAutoMerge: false,
      canUpdateBranch: pr.state === "open" && mergeState === "behind",
      mergeMethods: methods,
      defaultMergeMethod: methods[0] ?? "merge",
      removeSourceBranchDefault: false,
      diffRefs: null,
    };
  }

  private async canMergeAsAdmin(owner: string, repo: string, number: number): Promise<boolean> {
    const data = await this.graphql<{ repository: { pullRequest: { viewerCanMergeAsAdmin: boolean } | null } | null }>(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) { pullRequest(number: $number) { viewerCanMergeAsAdmin } }
      }`,
      { owner, repo, number },
    );
    return data.repository?.pullRequest?.viewerCanMergeAsAdmin ?? false;
  }

  /** Commentaires de la conversation et avis de relecture, par date. */
  async getComments(owner: string, repo: string, number: number): Promise<ForgeComment[]> {
    const base = `/repos/${seg(owner)}/${seg(repo)}`;
    const [comments, reviews] = await Promise.all([
      this.get<RawComment[]>(`${base}/issues/${number}/comments?per_page=100`),
      this.get<RawReview[]>(`${base}/pulls/${number}/reviews?per_page=100`),
    ]);
    const all: ForgeComment[] = [
      ...comments.map((c) => ({ id: `c${c.id}`, author: c.user?.login ?? "", body: c.body, createdAt: c.created_at })),
      ...reviews
        .filter((r) => r.body || r.state === "APPROVED" || r.state === "CHANGES_REQUESTED")
        .map((r): ForgeComment => ({
          id: `r${r.id}`,
          author: r.user?.login ?? "",
          body: r.body ?? "",
          createdAt: r.submitted_at ?? "",
          review: REVIEW_VERDICTS[r.state],
        })),
    ];
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addComment(owner: string, repo: string, number: number, body: string): Promise<void> {
    await this.send("POST", `/repos/${seg(owner)}/${seg(repo)}/issues/${number}/comments`, { body });
  }

  /** Une approbation GitHub ne se retire pas (seul un admin peut la rejeter). */
  async review(owner: string, repo: string, number: number, event: ReviewEvent, body: string): Promise<void> {
    if (event === "unapprove") throw new Error("GitHub ne permet pas de retirer sa propre approbation");
    await this.send("POST", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}/reviews`, {
      event: event === "approve" ? "APPROVE" : "REQUEST_CHANGES",
      body,
    });
  }

  /** Un merge forcé passe par la même requête : GitHub applique de lui-même les droits de contournement. */
  async merge(owner: string, repo: string, number: number, options: MergeOptions): Promise<void> {
    await this.send("PUT", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}/merge`, {
      merge_method: options.method,
      sha: options.sha,
    });
  }

  async setState(owner: string, repo: string, number: number, state: "open" | "closed"): Promise<void> {
    await this.send("PATCH", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}`, { state });
  }

  async updatePullRequest(owner: string, repo: string, number: number, edit: PullRequestEdit): Promise<void> {
    await this.send("PATCH", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}`, { title: edit.title, body: edit.description });
  }

  /**
   * Remplace assignés et relecteurs demandés. Retirer un relecteur passe par GraphQL : l'API REST l'exige en DELETE,
   * méthode refusée par le backend. Les équipes déjà demandées sont conservées.
   */
  async setPeople(owner: string, repo: string, number: number, people: PullRequestPeople): Promise<void> {
    const base = `/repos/${seg(owner)}/${seg(repo)}`;
    const raw = await this.get<RawPullRequest>(`${base}/pulls/${number}`);
    const assignees = people.assignees.map((u) => u.username);
    if (!sameSet(assignees, (raw.assignees ?? []).map((u) => u.login))) {
      await this.send("PATCH", `${base}/issues/${number}`, { assignees });
    }
    const reviewers = people.reviewers.map((u) => u.username);
    const requested = (raw.requested_reviewers ?? []).map((u) => u.login);
    if (sameSet(reviewers, requested)) return;
    if (requested.every((login) => reviewers.includes(login))) {
      await this.send("POST", `${base}/pulls/${number}/requested_reviewers`, {
        reviewers: reviewers.filter((login) => !requested.includes(login)),
      });
      return;
    }
    const logins = Object.fromEntries(reviewers.map((login, i) => [`u${i}`, login]));
    const declarations = reviewers.map((_, i) => `, $u${i}: String!`).join("");
    const users = reviewers.map((_, i) => `u${i}: user(login: $u${i}) { id }`).join(" ");
    const data = await this.graphql<Record<string, { id: string } | null> & {
      repository: { pullRequest: { id: string; reviewRequests: { nodes: { requestedReviewer: { id?: string } | null }[] } } | null } | null;
    }>(
      `query($owner: String!, $repo: String!, $number: Int!${declarations}) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) { id reviewRequests(first: 100) { nodes { requestedReviewer { ... on Team { id } } } } }
        }
        ${users}
      }`,
      { owner, repo, number, ...logins },
    );
    const pull = data.repository?.pullRequest;
    if (!pull) throw new Error(`Pull request #${number} introuvable`);
    const userIds = reviewers.map((login, i) => {
      const id = data[`u${i}`]?.id;
      if (!id) throw new Error(`Utilisateur GitHub introuvable : ${login}`);
      return id;
    });
    const teamIds = pull.reviewRequests.nodes.flatMap((n) => (n.requestedReviewer?.id ? [n.requestedReviewer.id] : []));
    await this.graphql(
      `mutation($id: ID!, $users: [ID!], $teams: [ID!]) {
        requestReviews(input: { pullRequestId: $id, userIds: $users, teamIds: $teams, union: false }) { clientMutationId }
      }`,
      { id: pull.id, users: userIds, teams: teamIds },
    );
  }

  /** Brouillon ↔ prête : uniquement disponible en GraphQL. */
  async setDraft(owner: string, repo: string, number: number, draft: boolean): Promise<void> {
    const raw = await this.get<RawPullRequest>(`/repos/${seg(owner)}/${seg(repo)}/pulls/${number}`);
    if (!raw.node_id) throw new Error("Identifiant GraphQL de la pull request introuvable");
    const mutation = draft ? "convertPullRequestToDraft" : "markPullRequestReadyForReview";
    await this.graphql(`mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`, { id: raw.node_id });
  }

  /** Fils de commentaires du diff : GraphQL, seul à exposer leur état résolu et leur ligne actuelle. */
  async getReviewThreads(owner: string, repo: string, number: number): Promise<ReviewThread[]> {
    const data = await this.graphql<{ repository: { pullRequest: { reviewThreads: { nodes: RawThread[] } } | null } | null }>(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id isResolved path line diffSide
                comments(first: 100) { nodes { databaseId body createdAt author { login } } }
              }
            }
          }
        }
      }`,
      { owner, name: repo, number },
    );
    return (data.repository?.pullRequest?.reviewThreads.nodes ?? []).map((t) => ({
      id: t.id,
      replyTo: String(t.comments.nodes[0]?.databaseId ?? ""),
      path: t.path,
      side: t.diffSide === "LEFT" ? "old" : "new",
      line: t.line,
      resolved: t.isResolved,
      comments: t.comments.nodes.map((c) => ({
        id: String(c.databaseId), author: c.author?.login ?? "", body: c.body, createdAt: c.createdAt,
      })),
    }));
  }

  async addLineComment(owner: string, repo: string, number: number, ctx: ReviewContext, position: LinePosition, body: string): Promise<void> {
    await this.send("POST", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}/comments`, {
      body, commit_id: ctx.headSha, ...lineComment(position),
    });
  }

  async replyToThread(owner: string, repo: string, number: number, replyTo: string, body: string): Promise<void> {
    await this.send("POST", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}/comments/${seg(replyTo)}/replies`, { body });
  }

  async resolveThread(threadId: string, resolved: boolean): Promise<void> {
    const mutation = resolved ? "resolveReviewThread" : "unresolveReviewThread";
    await this.graphql(`mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { isResolved } } }`, { id: threadId });
  }

  /** Une seule requête : la revue et ses commentaires de ligne sont publiés ensemble ou pas du tout. */
  async submitReview(owner: string, repo: string, number: number, ctx: ReviewContext, review: ReviewSubmission): Promise<SubmittedReview> {
    const events = { comment: "COMMENT", approve: "APPROVE", request_changes: "REQUEST_CHANGES" } as const;
    await this.send("POST", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}/reviews`, {
      commit_id: ctx.headSha,
      event: events[review.verdict],
      body: review.body,
      comments: review.comments.map((d) => ({ body: d.body, ...lineComment(d.position) })),
    });
    return { publishedIds: review.comments.map((d) => d.id), errors: [] };
  }

  /** Merge la branche cible dans la branche de la PR, côté GitHub. */
  async updateBranch(owner: string, repo: string, number: number, sha: string): Promise<void> {
    await this.send("PUT", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}/update-branch`, { expected_head_sha: sha });
  }

  async getBranches(owner: string, repo: string): Promise<string[]> {
    const branches = await this.get<{ name: string }[]>(`/repos/${seg(owner)}/${seg(repo)}/branches?per_page=100`);
    return branches.map((b) => b.name);
  }

  async setTargetBranch(owner: string, repo: string, number: number, branch: string): Promise<void> {
    await this.send("PATCH", `/repos/${seg(owner)}/${seg(repo)}/pulls/${number}`, { base: branch });
  }

  async getIssues(owner: string, repo: string, state: "open" | "closed" | "all" = "open"): Promise<ForgeIssue[]> {
    const data = await this.get<RawIssue[]>(`/repos/${seg(owner)}/${seg(repo)}/issues?state=${state}&per_page=50`);
    return data.filter((i) => !i.pull_request).map(parseIssue);
  }

  /** Issues ouvertes ou fermées : celle du numéro donné, sinon celles dont le titre ou le corps contient les mots. */
  async searchIssues(owner: string, repo: string, term: string): Promise<ForgeIssue[]> {
    const t = term.trim();
    if (/^\d+$/.test(t)) {
      // Une issue absente répond 404 : pas de résultat.
      const raw = await this.get<RawIssue>(`/repos/${seg(owner)}/${seg(repo)}/issues/${t}`).catch(() => null);
      return raw && !raw.pull_request ? [parseIssue(raw)] : [];
    }
    const q = encodeURIComponent(`repo:${owner}/${repo} is:issue ${t}`);
    const data = await this.get<{ items: RawIssue[] }>(`/search/issues?q=${q}&per_page=20`);
    return data.items.map(parseIssue);
  }

  /**
   * Modèles de description, sur la branche par défaut : le fichier `pull_request_template.md` (dans .github/, à la racine
   * ou dans docs/, casse indifférente), appliqué d'office par GitHub, et les modèles du dossier .github/PULL_REQUEST_TEMPLATE/.
   */
  async getPullRequestTemplates(owner: string, repo: string): Promise<PrTemplates> {
    const base = `/repos/${seg(owner)}/${seg(repo)}/contents`;
    const list = (dir: string) => this.get<RawContentEntry[]>(dir ? `${base}/${dir}` : base).catch((): RawContentEntry[] => []);
    const [github, root, docs] = await Promise.all([list(".github"), list(""), list("docs")]);
    const single = [...github, ...root, ...docs].find((e) => e.type === "file" && /^pull_request_template(\.(md|txt))?$/i.test(e.name));
    const folder = github.find((e) => e.type === "dir" && e.name.toLowerCase() === "pull_request_template");
    const extra = folder ? (await list(folder.path)).filter((e) => e.type === "file" && /\.(md|txt)$/i.test(e.name)) : [];

    const read = async (entry: RawContentEntry, name: string): Promise<PrTemplate | null> => {
      const file = await this.get<{ content?: string; encoding?: string }>(`${base}/${entry.path.split("/").map(seg).join("/")}`)
        .catch(() => null);
      return file?.content && file.encoding === "base64" ? { name, content: decodeBase64(file.content) } : null;
    };
    const [main, ...others] = await Promise.all([
      single ? read(single, single.path) : null,
      ...extra.map((e) => read(e, e.name.replace(/\.(md|txt)$/i, ""))),
    ]);
    const templates = [main, ...others].filter((t): t is PrTemplate => !!t);
    return { templates, defaultName: main?.name ?? null };
  }

  async getPullRequestOptions(owner: string, repo: string): Promise<PullRequestOptions> {
    const base = `/repos/${seg(owner)}/${seg(repo)}`;
    const [info, users, labels, milestones] = await Promise.all([
      this.get<{ default_branch: string }>(base),
      this.get<RawUser[]>(`${base}/assignees?per_page=100`),
      this.get<RawLabel[]>(`${base}/labels?per_page=100`),
      this.get<RawMilestone[]>(`${base}/milestones?state=open&per_page=100`),
    ]);
    return {
      defaultBranch: info.default_branch,
      users: users.map((u): ForgeUser => ({ id: u.id ?? 0, username: u.login, name: u.login })),
      labels: labels.map((l): ForgeLabel => ({ name: l.name, color: `#${l.color ?? "888888"}` })),
      milestones: milestones.map((m): ForgeMilestone => ({ id: m.number, title: m.title })),
      squashDefault: false,
      removeSourceBranchDefault: false,
    };
  }

  /**
   * Crée la PR, puis demande les relecteurs et pose assignés / labels / jalon (API des issues).
   * Ces étapes secondaires n'annulent pas la création si elles échouent.
   */
  async createPullRequest(owner: string, repo: string, input: NewPullRequest): Promise<CreatedPullRequest> {
    const base = `/repos/${seg(owner)}/${seg(repo)}`;
    const raw = await this.send<RawPullRequest>("POST", `${base}/pulls`, {
      title: input.title,
      body: input.description,
      head: input.sourceBranch,
      base: input.targetBranch,
      draft: input.draft,
    });
    const warnings: string[] = [];
    if (input.reviewers.length) {
      await this.send("POST", `${base}/pulls/${raw.number}/requested_reviewers`, {
        reviewers: input.reviewers.map((u) => u.username),
      }).catch((e) => warnings.push(`relecteurs : ${errorMessage(e)}`));
    }
    if (input.assignees.length || input.labels.length || input.milestone) {
      const patch: Record<string, unknown> = {};
      if (input.assignees.length) patch.assignees = input.assignees.map((u) => u.username);
      if (input.labels.length) patch.labels = input.labels;
      if (input.milestone) patch.milestone = input.milestone.id;
      await this.send("PATCH", `${base}/issues/${raw.number}`, patch)
        .catch((e) => warnings.push(`assignés / labels / jalon : ${errorMessage(e)}`));
    }
    return { pr: parsePR(raw), warnings };
  }
}

function parsePR(raw: RawPullRequest): ForgePR {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.merged_at ? "merged" : raw.state,
    author: raw.user?.login ?? "",
    url: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at ?? raw.created_at,
    headSha: raw.head?.sha ?? "",
    commentCount: raw.comments === undefined ? undefined : raw.comments + (raw.review_comments ?? 0),
    draft: raw.draft ?? false,
    labels: (raw.labels ?? []).map((l) => l.name),
    sourceBranch: raw.head?.ref ?? "",
    targetBranch: raw.base?.ref ?? "",
    reviewers: (raw.requested_reviewers ?? []).map((u) => u.login),
    assignees: (raw.assignees ?? []).map((u) => u.login),
  };
}

interface RawContentEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
}

/** Contenu base64 de l'API (découpé en lignes) vers du texte UTF-8. */
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

const CI_STATES: Record<string, PrSummary["ci"]> = {
  SUCCESS: "success", FAILURE: "failure", ERROR: "failure", PENDING: "pending", EXPECTED: "pending",
};

function reviewState(raw: RawReviewState): PrSummary["review"] {
  const verdicts = raw.latestOpinionatedReviews.nodes.map((r) => r.state);
  // Sans relecture obligatoire, GitHub ne donne pas de décision : on la déduit des derniers avis.
  if (raw.reviewDecision === "CHANGES_REQUESTED" || (!raw.reviewDecision && verdicts.includes("CHANGES_REQUESTED"))) return "changes_requested";
  if (raw.reviewDecision === "APPROVED" || (!raw.reviewDecision && verdicts.includes("APPROVED"))) return "approved";
  return "pending";
}

/** `me` : login connecté ; GitHub ne dit pas qui a poussé, le committer du dernier commit en tient lieu. */
function parseSearchPR(raw: RawSearchPullRequest, me?: string): PrSummary {
  const head = raw.commits.nodes[0]?.commit;
  const rollup = head?.statusCheckRollup;
  const committer = head?.committer?.user?.login;
  return {
    number: raw.number!,
    title: raw.title,
    state: "open",
    author: raw.author?.login ?? "",
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    headSha: raw.headRefOid,
    draft: raw.isDraft,
    labels: raw.labels.nodes.map((l) => l.name),
    sourceBranch: raw.headRefName,
    targetBranch: raw.baseRefName,
    reviewers: raw.reviewRequests.nodes.flatMap((r) => (r.requestedReviewer?.login ? [r.requestedReviewer.login] : [])),
    assignees: raw.assignees.nodes.map((u) => u.login),
    projectPath: raw.repository.nameWithOwner,
    review: reviewState(raw),
    ci: rollup ? CI_STATES[rollup.state] ?? null : null,
    conflicts: raw.mergeable === "CONFLICTING",
    pushedByMe: !!me && committer === me,
  };
}

/** Sans doublon (même projet et même numéro), dans l'ordre d'arrivée. */
export function uniquePrs<T extends { projectPath: string; number: number }>(prs: T[]): T[] {
  const seen = new Set<string>();
  return prs.filter((pr) => {
    const key = `${pr.projectPath}#${pr.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface RawThread {
  id: string;
  isResolved: boolean;
  path: string;
  /** null quand le commentaire porte sur une version dépassée du diff. */
  line: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: { nodes: { databaseId: number; body: string; createdAt: string; author: { login: string } | null }[] };
}

/** Champs de position d'un commentaire de ligne GitHub (`path` est toujours le chemin actuel). */
function lineComment(p: LinePosition) {
  return { path: p.path, line: p.line, side: p.side === "old" ? "LEFT" : "RIGHT" };
}

const REVIEW_VERDICTS: Partial<Record<RawReview["state"], ForgeComment["review"]>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
};

function describeMergeState(pr: ForgePR, raw: RawPullRequest, settings: RawRepoSettings): string {
  const mergeState = raw.mergeable_state ?? "unknown";
  if (pr.state === "merged") return "Déjà mergée";
  if (pr.state === "closed") return "Fermée";
  if (settings.permissions?.push === false) return "Droits insuffisants pour merger";
  if (raw.mergeable == null || mergeState === "unknown") return "Vérification de la mergeabilité en cours…";
  return MERGE_STATES[mergeState] ?? `Merge impossible (${mergeState})`;
}

function parseCheckRun(run: RawCheckRun): ForgeCheck {
  let status: ForgeCheck["status"];
  if (run.status !== "completed") status = "pending";
  else if (run.conclusion === "success" || run.conclusion === "neutral") status = "success";
  else if (run.conclusion === "skipped" || run.conclusion === "cancelled") status = "skipped";
  else status = "failure";
  return { name: run.name, status, url: run.html_url };
}

function parseStatus(raw: RawStatus): ForgeCheck {
  const status = raw.state === "error" ? "failure" : raw.state;
  return { name: raw.context, status, url: raw.target_url };
}

function parseIssue(raw: RawIssue): ForgeIssue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    author: raw.user?.login ?? "",
    url: raw.html_url,
    createdAt: raw.created_at,
    labels: (raw.labels ?? []).map((l) => l.name),
  };
}
