import type {
  CreatedPullRequest, ForgeCheck, ForgeComment, ForgeIssue, ForgePR, ForgeRepo, LinePosition, MergeMethod, MergeOptions,
  MyPullRequests, NewPullRequest, PrSummary, PrTemplate, PrTemplates, PullRequestDetails, PullRequestOptions, PullRequestState, ReviewContext, ReviewEvent, ReviewSubmission,
  ReviewThread, SubmittedReview,
} from "../types/forge";
import { PR_PAGE_SIZE } from "../types/forge";
import { errorMessage } from "../lib/actions";
import { uniquePrs, type ApiGet, type ApiSend } from "./github";

// Champs lus dans les réponses de l'API GitLab (le reste est ignoré).
interface RawUser {
  id?: number;
  username: string;
  name?: string;
  state?: string;
}

interface RawProjectSettings {
  default_branch: string;
  merge_method?: "merge" | "rebase_merge" | "ff";
  squash_option?: "never" | "always" | "default_on" | "default_off";
  remove_source_branch_after_merge?: boolean;
}

interface RawProject {
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  visibility: "public" | "internal" | "private";
  description: string | null;
  last_activity_at: string;
}

interface RawIssue {
  iid: number;
  title: string;
  state: "opened" | "closed";
  author: RawUser | null;
  web_url: string;
  created_at: string;
  updated_at?: string;
  labels?: string[];
}

interface RawMergeRequest extends Omit<RawIssue, "state"> {
  state: "opened" | "closed" | "merged" | "locked";
  draft?: boolean;
  source_branch?: string;
  target_branch?: string;
  sha?: string;
  user_notes_count?: number;
  project_id?: number;
  /** `full` : "group/sub/projet!12". */
  references?: { full?: string };
  has_conflicts?: boolean;
  reviewers?: RawUser[];
  assignees?: RawUser[];
}

interface RawMergeRequestDetails extends RawMergeRequest {
  description: string | null;
  /** GitLab ≥ 15.6 ; avant, seul `merge_status` existe. */
  detailed_merge_status?: string;
  merge_status?: string;
  /** Auto-merge déjà programmé. */
  merge_when_pipeline_succeeds?: boolean;
  squash?: boolean;
  force_remove_source_branch?: boolean | null;
  head_pipeline?: { id: number; status: string; web_url: string } | null;
  diff_refs?: { base_sha: string; start_sha: string; head_sha: string } | null;
  user?: { can_merge?: boolean };
}

interface RawApprovals {
  approved_by?: { user: RawUser }[];
  approvals_left?: number;
  user_has_approved?: boolean;
}

interface RawNote {
  id: number;
  author: RawUser | null;
  body: string;
  created_at: string;
  system: boolean;
  /** "DiffNote" pour un commentaire de ligne. */
  type?: string | null;
  position?: { position_type: string; new_path: string; old_path: string; new_line: number | null; old_line: number | null } | null;
  resolvable?: boolean;
  resolved?: boolean;
}

interface RawDiscussion {
  id: string;
  notes: RawNote[];
}

interface RawJob {
  name: string;
  status: string;
  web_url: string;
  allow_failure?: boolean;
}

/** Explication de `detailed_merge_status` (https://docs.gitlab.com/api/merge_requests/#merge-status). */
const MERGE_STATUSES: Record<string, string> = {
  mergeable: "Prête à merger",
  can_be_merged: "Prête à merger",
  checking: "Vérification de la mergeabilité en cours…",
  unchecked: "Vérification de la mergeabilité en cours…",
  preparing: "Vérification de la mergeabilité en cours…",
  approvals_syncing: "Synchronisation des approbations…",
  ci_must_pass: "Le pipeline doit réussir avant le merge",
  ci_still_running: "Pipeline en cours",
  discussions_not_resolved: "Des discussions ne sont pas résolues",
  draft_status: "Brouillon : à passer en « prête » avant le merge",
  not_approved: "Approbations requises manquantes",
  requested_changes: "Des changements ont été demandés",
  conflict: "Conflits avec la branche cible",
  cannot_be_merged: "Conflits avec la branche cible",
  need_rebase: "Rebase nécessaire sur la branche cible",
  blocked_status: "Bloquée par une autre merge request",
  not_open: "Merge request non ouverte",
};

const PROJECT_TEMPLATE = "Modèle du projet";

const API_STATES: Record<PullRequestState, string> = { open: "opened", merged: "merged", closed: "closed", all: "all" };

const MR_STATES: Record<RawMergeRequest["state"], ForgePR["state"]> = {
  opened: "open",
  merged: "merged",
  closed: "closed",
  locked: "closed",
};

export class GitLabClient {
  constructor(private get: ApiGet, private send: ApiSend = () => Promise.reject(new Error("Écriture non disponible"))) {}

  private encodeProject(project: string): string {
    // Numeric ID passé tel quel, sinon encode le chemin
    if (/^\d+$/.test(project)) return project;
    return encodeURIComponent(project);
  }

  /** Valide le token et renvoie le nom d'utilisateur associé. */
  async getCurrentUser(): Promise<string> {
    const user = await this.get<RawUser>("/user");
    return user.username;
  }

  async listRepos(): Promise<ForgeRepo[]> {
    const data = await this.get<RawProject[]>(
      "/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true"
    );
    return data.map((p) => ({
      name: p.name,
      fullName: p.path_with_namespace,
      cloneUrl: p.http_url_to_repo,
      sshUrl: p.ssh_url_to_repo,
      private: p.visibility !== "public",
      description: p.description ?? "",
      updatedAt: p.last_activity_at,
    }));
  }

  async getMergeRequests(project: string, state: PullRequestState = "open"): Promise<ForgePR[]> {
    const id = this.encodeProject(project);
    const data = await this.get<RawMergeRequest[]>(
      `/projects/${id}/merge_requests?state=${API_STATES[state]}&per_page=${PR_PAGE_SIZE}`
    );
    // La liste ne donne pas les approbations : une requête par MR ouverte.
    return Promise.all(data.map(async (raw) => {
      const mr = parseMR(raw);
      if (mr.state !== "open") return mr;
      const approvals = await this.get<RawApprovals>(`/projects/${id}/merge_requests/${raw.iid}/approvals`).catch((): RawApprovals => ({}));
      return { ...mr, approved: isApproved(approvals) };
    }));
  }

  async getMergeRequest(project: string, iid: number): Promise<ForgePR> {
    return parseMR(await this.get<RawMergeRequest>(`/projects/${this.encodeProject(project)}/merge_requests/${iid}`));
  }

  /**
   * MR ouvertes de tous les projets : assignées, relecture demandée (fusionnées sans doublon) et ouvertes par moi.
   * Une requête d'approbations par MR, et pour les miennes une de détail (pipeline) : la liste ne les donne pas.
   */
  async getMyMergeRequests(me: string): Promise<MyPullRequests> {
    const open = `state=opened&per_page=${PR_PAGE_SIZE}`;
    const [assigned, reviewing, authored] = await Promise.all([
      this.get<RawMergeRequest[]>(`/merge_requests?scope=assigned_to_me&${open}`),
      this.get<RawMergeRequest[]>(`/merge_requests?scope=all&reviewer_username=${encodeURIComponent(me)}&${open}`),
      this.get<RawMergeRequest[]>(`/merge_requests?scope=created_by_me&${open}`),
    ]);
    const mrPath = (raw: RawMergeRequest) => `/projects/${raw.project_id}/merge_requests/${raw.iid}`;
    const approvalsOf = (raw: RawMergeRequest) => this.get<RawApprovals>(`${mrPath(raw)}/approvals`).catch((): RawApprovals => ({}));
    const [mine, toProcess] = await Promise.all([
      Promise.all(authored.map(async (raw) => {
        const [details, approvals] = await Promise.all([
          this.get<RawMergeRequestDetails>(mrPath(raw)).catch(() => null),
          approvalsOf(raw),
        ]);
        return parseSummary(details ?? raw, approvals);
      })),
      Promise.all(uniquePrs([...assigned, ...reviewing].map((raw) => ({ raw, ...parseSummary(raw) })))
        .map(async ({ raw }) => parseSummary(raw, await approvalsOf(raw)))),
    ]);
    return { assigned: toProcess, authored: mine };
  }

  /** Les jobs du pipeline sont facultatifs : à défaut, le statut global du pipeline est affiché. */
  async getMergeRequestDetails(project: string, iid: number, me: string): Promise<PullRequestDetails> {
    const id = this.encodeProject(project);
    const mrPath = `/projects/${id}/merge_requests/${iid}`;
    const [raw, settings, approvals] = await Promise.all([
      this.get<RawMergeRequestDetails>(mrPath),
      this.get<RawProjectSettings>(`/projects/${id}`),
      this.get<RawApprovals>(`${mrPath}/approvals`).catch((): RawApprovals => ({})),
    ]);
    const pipeline = raw.head_pipeline;
    let checks: ForgeCheck[] = [];
    if (pipeline) {
      checks = await this.get<RawJob[]>(`/projects/${id}/pipelines/${pipeline.id}/jobs?per_page=100`)
        .then((jobs) => jobs.map(parseJob))
        .catch(() => [parseJob({ name: "Pipeline", status: pipeline.status, web_url: pipeline.web_url })]);
    }

    const pr = parseMR(raw);
    const status = raw.detailed_merge_status ?? raw.merge_status ?? "unchecked";
    const canMerge = raw.user?.can_merge !== false;
    let mergeStatus: string;
    if (pr.state !== "open") mergeStatus = pr.state === "merged" ? "Déjà mergée" : "Fermée";
    else if (!canMerge) mergeStatus = "Droits insuffisants pour merger";
    else if (raw.merge_when_pipeline_succeeds) mergeStatus = "Auto-merge programmé : merge dès que le pipeline réussit";
    else mergeStatus = MERGE_STATUSES[status] ?? `Merge impossible (${status})`;

    const squashOption = settings.squash_option ?? "default_off";
    let methods: MergeMethod[] = ["merge", "squash"];
    if (squashOption === "never") methods = ["merge"];
    if (squashOption === "always") methods = ["squash"];
    const squashByDefault = raw.squash ?? (squashOption === "default_on" || squashOption === "always");
    const approvers = (approvals.approved_by ?? []).map((a) => a.user);
    const approvedBy = approvers.map((u) => u.username);

    return {
      pr,
      description: raw.description ?? "",
      headSha: pr.headSha,
      approvedBy,
      changesRequestedBy: [],
      approvedByMe: approvals.user_has_approved ?? approvedBy.includes(me),
      names: fullNames([...(raw.reviewers ?? []), ...(raw.assignees ?? []), ...approvers]),
      approvalsLeft: approvals.approvals_left ?? null,
      checks,
      mergeable: pr.state === "open" && canMerge && (status === "mergeable" || status === "can_be_merged"),
      mergeStatus,
      canForceMerge: false,
      canAutoMerge: pr.state === "open" && canMerge && !raw.merge_when_pipeline_succeeds
        && !!pipeline && PIPELINE_STATES[pipeline.status] === "pending"
        && ["mergeable", "can_be_merged", "ci_still_running"].includes(status),
      canUpdateBranch: pr.state === "open" && status === "need_rebase",
      mergeMethods: methods,
      defaultMergeMethod: squashByDefault && methods.includes("squash") ? "squash" : methods[0],
      removeSourceBranchDefault: raw.force_remove_source_branch ?? settings.remove_source_branch_after_merge ?? false,
      diffRefs: raw.diff_refs
        ? { baseSha: raw.diff_refs.base_sha, startSha: raw.diff_refs.start_sha, headSha: raw.diff_refs.head_sha }
        : null,
    };
  }

  /** Notes de discussion générales, sans les notes système (« a ajouté 1 commit »…) ni les commentaires de ligne. */
  async getComments(project: string, iid: number): Promise<ForgeComment[]> {
    const id = this.encodeProject(project);
    const notes = await this.get<RawNote[]>(
      `/projects/${id}/merge_requests/${iid}/notes?sort=asc&order_by=created_at&per_page=100`
    );
    return notes
      .filter((n) => !n.system && n.type !== "DiffNote")
      .map((n) => ({ id: String(n.id), author: n.author?.username ?? "", body: n.body, createdAt: n.created_at }));
  }

  async addComment(project: string, iid: number, body: string): Promise<void> {
    await this.send("POST", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/notes`, { body });
  }

  /** L'API REST ne permet que d'approuver ou de retirer son approbation ; un commentaire accompagne l'avis s'il y en a un. */
  async review(project: string, iid: number, event: ReviewEvent, body: string): Promise<void> {
    if (event === "request_changes") throw new Error("La demande de changements n'est pas disponible dans l'API GitLab");
    const path = `/projects/${this.encodeProject(project)}/merge_requests/${iid}`;
    await this.send("POST", `${path}/${event}`, null);
    if (body.trim()) await this.addComment(project, iid, body);
  }

  /** Sans `autoMerge`, le merge est immédiat : il n'attend pas un pipeline en cours. */
  async merge(project: string, iid: number, options: MergeOptions): Promise<void> {
    await this.send("PUT", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/merge`, {
      sha: options.sha,
      squash: options.method === "squash",
      should_remove_source_branch: options.removeSourceBranch,
      ...(options.autoMerge ? { merge_when_pipeline_succeeds: true } : {}),
    });
  }

  async setState(project: string, iid: number, state: "open" | "closed"): Promise<void> {
    await this.send("PUT", `/projects/${this.encodeProject(project)}/merge_requests/${iid}`, {
      state_event: state === "open" ? "reopen" : "close",
    });
  }

  async getReviewThreads(project: string, iid: number): Promise<ReviewThread[]> {
    const discussions = await this.get<RawDiscussion[]>(
      `/projects/${this.encodeProject(project)}/merge_requests/${iid}/discussions?per_page=100`
    );
    return discussions.flatMap((d): ReviewThread[] => {
      const first = d.notes[0];
      const pos = first?.position;
      if (!pos || pos.position_type !== "text") return [];
      const side = pos.new_line != null ? "new" : "old";
      return [{
        id: d.id,
        replyTo: d.id,
        path: pos.new_path,
        side,
        line: side === "new" ? pos.new_line : pos.old_line,
        resolved: first.resolvable ? !!first.resolved : null,
        comments: d.notes.map((n) => ({ id: String(n.id), author: n.author?.username ?? "", body: n.body, createdAt: n.created_at })),
      }];
    });
  }

  /** Les trois commits de `diff_refs` situent la ligne dans la version du diff commentée. */
  async addLineComment(project: string, iid: number, ctx: ReviewContext, position: LinePosition, body: string): Promise<void> {
    const refs = ctx.diffRefs;
    if (!refs) throw new Error("Références du diff indisponibles : recharge la merge request");
    await this.send("POST", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/discussions`, {
      body,
      position: {
        position_type: "text",
        base_sha: refs.baseSha,
        start_sha: refs.startSha,
        head_sha: refs.headSha,
        old_path: position.oldPath,
        new_path: position.path,
        // Ligne ajoutée : new_line seul ; supprimée : old_line seul ; inchangée : les deux.
        ...(position.newLine != null && { new_line: position.newLine }),
        ...(position.oldLine != null && { old_line: position.oldLine }),
      },
    });
  }

  async replyToThread(project: string, iid: number, discussionId: string, body: string): Promise<void> {
    await this.send("POST", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/discussions/${encodeURIComponent(discussionId)}/notes`, { body });
  }

  async resolveThread(project: string, iid: number, discussionId: string, resolved: boolean): Promise<void> {
    await this.send("PUT", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/discussions/${encodeURIComponent(discussionId)}`, { resolved });
  }

  /**
   * GitLab n'a pas d'équivalent REST d'une revue GitHub : les commentaires sont publiés un par un, puis le commentaire
   * général et l'approbation. Un échec n'interrompt pas les suivants ; les brouillons non publiés sont conservés.
   */
  async submitReview(project: string, iid: number, ctx: ReviewContext, review: ReviewSubmission): Promise<SubmittedReview> {
    if (review.verdict === "request_changes") throw new Error("La demande de changements n'est pas disponible dans l'API GitLab");
    const publishedIds: string[] = [];
    const errors: string[] = [];
    for (const draft of review.comments) {
      try {
        await this.addLineComment(project, iid, ctx, draft.position, draft.body);
        publishedIds.push(draft.id);
      } catch (e) {
        errors.push(`${draft.position.path}:${draft.position.line} : ${errorMessage(e)}`);
      }
    }
    if (review.body.trim()) {
      await this.addComment(project, iid, review.body).catch((e) => errors.push(`commentaire : ${errorMessage(e)}`));
    }
    if (review.verdict === "approve") {
      await this.send("POST", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/approve`, null)
        .catch((e) => errors.push(`approbation : ${errorMessage(e)}`));
    }
    return { publishedIds, errors };
  }

  /** Un brouillon GitLab est une MR dont le titre commence par « Draft: ». */
  async setDraft(project: string, iid: number, draft: boolean): Promise<void> {
    const path = `/projects/${this.encodeProject(project)}/merge_requests/${iid}`;
    const raw = await this.get<RawMergeRequest>(path);
    await this.send("PUT", path, { title: draftTitle(raw.title, draft) });
  }

  /** Lance un rebase de la branche source sur la cible, côté GitLab (asynchrone). */
  async rebase(project: string, iid: number): Promise<void> {
    await this.send("PUT", `/projects/${this.encodeProject(project)}/merge_requests/${iid}/rebase`, null);
  }

  async getIssues(project: string, state: "opened" | "closed" | "all" = "opened"): Promise<ForgeIssue[]> {
    const id = this.encodeProject(project);
    const data = await this.get<RawIssue[]>(
      `/projects/${id}/issues?state=${state}&per_page=50`
    );
    return data.map(parseIssue);
  }

  /**
   * Modèles de description de MR (.gitlab/merge_request_templates/, plus ceux hérités du groupe ou de l'instance).
   * Appliqué d'office : celui saisi dans les réglages du projet, sinon celui nommé « Default ».
   */
  async getMergeRequestTemplates(project: string): Promise<PrTemplates> {
    const id = this.encodeProject(project);
    const [list, settings] = await Promise.all([
      this.get<{ key?: string; name: string }[]>(`/projects/${id}/templates/merge_requests`).catch(() => []),
      this.get<{ merge_requests_template?: string | null }>(`/projects/${id}`).catch(() => ({ merge_requests_template: null })),
    ]);
    const templates = (await Promise.all(list.map((t) =>
      this.get<{ content: string }>(`/projects/${id}/templates/merge_requests/${encodeURIComponent(t.key ?? t.name)}`)
        .then((full): PrTemplate => ({ name: t.name, content: full.content }))
        .catch(() => null),
    ))).filter((t): t is PrTemplate => !!t);
    // Modèle saisi directement dans les réglages du projet (GitLab Premium) : prioritaire, proposé en premier.
    const projectTemplate = settings.merge_requests_template;
    if (projectTemplate?.trim()) {
      templates.unshift({ name: PROJECT_TEMPLATE, content: projectTemplate });
      return { templates, defaultName: PROJECT_TEMPLATE };
    }
    return { templates, defaultName: templates.find((t) => t.name.toLowerCase() === "default")?.name ?? null };
  }

  async getMergeRequestOptions(project: string): Promise<PullRequestOptions> {
    const id = this.encodeProject(project);
    const [info, members, labels, milestones] = await Promise.all([
      this.get<RawProjectSettings>(`/projects/${id}`),
      this.get<RawUser[]>(`/projects/${id}/members/all?per_page=100`),
      this.get<{ name: string; color: string }[]>(`/projects/${id}/labels?per_page=100`),
      this.get<{ id: number; title: string }[]>(`/projects/${id}/milestones?state=active&per_page=100`),
    ]);
    return {
      defaultBranch: info.default_branch,
      users: members
        .filter((m) => m.state !== "blocked")
        .map((m) => ({ id: m.id ?? 0, username: m.username, name: m.name ?? m.username })),
      labels: labels.map((l) => ({ name: l.name, color: l.color })),
      milestones: milestones.map((m) => ({ id: m.id, title: m.title })),
      squashDefault: info.squash_option === "always" || info.squash_option === "default_on",
      removeSourceBranchDefault: info.remove_source_branch_after_merge ?? false,
    };
  }

  /** Tout passe dans la requête de création ; un brouillon est marqué par le préfixe « Draft: ». */
  async createMergeRequest(project: string, input: NewPullRequest): Promise<CreatedPullRequest> {
    const id = this.encodeProject(project);
    const raw = await this.send<RawMergeRequest>("POST", `/projects/${id}/merge_requests`, {
      source_branch: input.sourceBranch,
      target_branch: input.targetBranch,
      title: input.draft ? draftTitle(input.title, true) : input.title,
      description: input.description,
      assignee_ids: input.assignees.map((u) => u.id),
      reviewer_ids: input.reviewers.map((u) => u.id),
      labels: input.labels.join(","),
      milestone_id: input.milestone?.id,
      remove_source_branch: input.removeSourceBranch,
      squash: input.squash,
    });
    return { pr: parseMR(raw), warnings: [] };
  }
}

const DRAFT_PREFIX = /^\s*(draft:|\[draft\]|\(draft\)|draft\s+-|wip:|\[wip\])\s*/i;

/** Ajoute ou retire le préfixe de brouillon reconnu par GitLab. */
export function draftTitle(title: string, draft: boolean): string {
  const bare = title.replace(DRAFT_PREFIX, "");
  return draft ? `Draft: ${bare}` : bare;
}

/** Nom complet par login, pour ceux dont GitLab le donne. */
function fullNames(users: RawUser[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const u of users) {
    if (u.name) names[u.username] = u.name;
  }
  return names;
}

function parseMR(raw: RawMergeRequest): ForgePR {
  return {
    number: raw.iid,
    title: raw.title,
    state: MR_STATES[raw.state] ?? "closed",
    author: raw.author?.username ?? "",
    url: raw.web_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at ?? raw.created_at,
    headSha: raw.sha ?? "",
    commentCount: raw.user_notes_count,
    draft: raw.draft ?? false,
    labels: raw.labels ?? [],
    sourceBranch: raw.source_branch ?? "",
    targetBranch: raw.target_branch ?? "",
    reviewers: (raw.reviewers ?? []).map((u) => u.username),
    assignees: (raw.assignees ?? []).map((u) => u.username),
  };
}

const PIPELINE_STATES: Record<string, PrSummary["ci"]> = {
  success: "success", failed: "failure",
  created: "pending", waiting_for_resource: "pending", preparing: "pending", pending: "pending", running: "pending", scheduled: "pending",
};

/** Au moins une approbation, et plus aucune requise. */
function isApproved(approvals: RawApprovals): boolean {
  return !!approvals.approved_by?.length && !approvals.approvals_left;
}

/** MR d'un projet quelconque ; sans approbations ni détail, seul ce que donne la liste est connu. */
function parseSummary(raw: RawMergeRequest & Partial<RawMergeRequestDetails>, approvals?: RawApprovals): PrSummary {
  const full = raw.references?.full ?? "";
  let review: PrSummary["review"] = "pending";
  if (raw.detailed_merge_status === "requested_changes") review = "changes_requested";
  else if (approvals && isApproved(approvals)) review = "approved";
  return {
    ...parseMR(raw),
    projectPath: full.includes("!") ? full.slice(0, full.lastIndexOf("!")) : "",
    review,
    ci: raw.head_pipeline ? PIPELINE_STATES[raw.head_pipeline.status] ?? null : null,
    conflicts: raw.has_conflicts ?? false,
  };
}

function parseJob(job: RawJob): ForgeCheck {
  let status: ForgeCheck["status"];
  if (job.status === "success") status = "success";
  else if (job.status === "failed") status = job.allow_failure ? "skipped" : "failure";
  else if (["canceled", "skipped", "manual"].includes(job.status)) status = "skipped";
  else status = "pending";
  return { name: job.name, status, url: job.web_url };
}

function parseIssue(raw: RawIssue): ForgeIssue {
  return {
    number: raw.iid,
    title: raw.title,
    state: raw.state === "opened" ? "open" : "closed",
    author: raw.author?.username ?? "",
    url: raw.web_url,
    createdAt: raw.created_at,
    labels: raw.labels ?? [],
  };
}
