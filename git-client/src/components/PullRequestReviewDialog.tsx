import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, Check, CircleDashed, CircleX, ExternalLink, MinusCircle, RotateCw } from "lucide-react";
import { forgeClient } from "../api/forge";
import { useUiStore, confirmAction } from "../store/useUiStore";
import { seenKey, useSeenPrsStore } from "../store/useSeenPrsStore";
import { errorMessage } from "../lib/actions";
import type {
  DraftComment, ForgeAccount, ForgeCheck, ForgeComment, ForgePR, MergeMethod, PullRequestDetails, ReviewEvent,
} from "../types/forge";
import { Button, Modal, inputClass } from "./Modal";
import { PullRequestFiles } from "./PullRequestFiles";
import { PullRequestBranchSync } from "./PullRequestBranchSync";
import { fieldLabel } from "../lib/fieldLabel";

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]";

const STATE_STYLES: Record<ForgePR["state"], { label: string; className: string }> = {
  open: { label: "Ouverte", className: "bg-green-500/20 text-green-300" },
  merged: { label: "Mergée", className: "bg-purple-500/20 text-purple-300" },
  closed: { label: "Fermée", className: "bg-red-500/20 text-red-300" },
};

const METHOD_LABELS: Record<MergeMethod, string> = {
  merge: "Commit de merge",
  squash: "Squash",
  rebase: "Rebase",
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso: string) => (iso ? dateFormat.format(new Date(iso)) : "");

/** Panneau de revue d'une PR / MR : détail, CI, commentaires, fichiers modifiés, approbation, merge et fermeture. */
export function PullRequestReviewDialog({ account, projectPath, remoteName, number, onCheckout, onChanged, onClose }: {
  account: ForgeAccount;
  projectPath: string;
  /** Remote local du projet : sert au calcul du diff. null : projet sans dépôt ouvert (pas de fichiers ni de checkout). */
  remoteName: string | null;
  number: number;
  onCheckout?: (pr: ForgePR) => void;
  /** La PR a changé d'état (merge, fermeture…) : la liste doit être rechargée. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const isGitHub = account.provider === "github";
  const ref = isGitHub ? `#${number}` : `!${number}`;
  const forgeName = isGitHub ? "GitHub" : "GitLab";
  const notify = useUiStore((s) => s.notify);

  const [details, setDetails] = useState<PullRequestDetails | null>(null);
  const [comments, setComments] = useState<ForgeComment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [removeSource, setRemoveSource] = useState(false);
  /** Action en cours : désactive les autres boutons. */
  const [pending, setPending] = useState<string | null>(null);
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  /** Commentaires de ligne en attente de publication avec la revue. */
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  /** Les choix de merge ne sont initialisés qu'au premier chargement, pas à chaque actualisation. */
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const client = forgeClient(account);
    try {
      const [d, c] = await Promise.all([
        client.getPullRequestDetails(projectPath, number),
        client.getComments(projectPath, number),
      ]);
      setDetails(d);
      setComments(c);
      // Consultée dans l'état qu'on vient d'afficher (rechargé aussi après chaque action : son propre commentaire ne la rend pas « modifiée »).
      useSeenPrsStore.getState().markSeen(seenKey(account.id, projectPath, number), d.pr);
      if (!initialized.current) {
        initialized.current = true;
        setMethod(d.defaultMergeMethod);
        setRemoveSource(d.removeSourceBranchDefault);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [account, projectPath, number]);

  useEffect(() => {
    load();
  }, [load]);

  /** Exécute une action sur la forge puis recharge le détail ; `changed` recharge aussi la liste. */
  async function run(label: string, fn: () => Promise<void>, success: string, changed = false) {
    setPending(label);
    try {
      await fn();
      notify("success", success);
      if (changed) onChanged();
      await load();
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  const client = () => forgeClient(account);

  function sendComment() {
    const body = reply.trim();
    if (!body) return;
    run("comment", async () => {
      await client().addComment(projectPath, number, body);
      setReply("");
    }, "Commentaire publié");
  }

  function sendReview(event: ReviewEvent) {
    const messages: Record<ReviewEvent, string> = {
      approve: `${ref} approuvée`,
      unapprove: "Approbation retirée",
      request_changes: "Changements demandés",
    };
    run(event, async () => {
      await client().review(projectPath, number, event, reply.trim());
      setReply("");
    }, messages[event]);
  }

  async function handleMerge(mode: MergeMode) {
    if (!details) return;
    const { pr } = details;
    const extra = removeSource ? `, puis suppression de ${pr.sourceBranch}` : "";
    const summary = `${pr.sourceBranch} → ${pr.targetBranch} (${METHOD_LABELS[method].toLowerCase()}${extra}).`;
    const prompts: Record<MergeMode, [string, string]> = {
      merge: [`Merger ${ref} ?`, `${summary} Cette action est irréversible.`],
      force: [
        `Forcer le merge de ${ref} ?`,
        `${summary} Les exigences de la branche (${details.mergeStatus.toLowerCase()}) seront contournées avec tes droits. Cette action est irréversible.`,
      ],
      auto: [`Programmer le merge de ${ref} ?`, `${summary} Le merge se fera dès que le pipeline réussit.`],
    };
    if (!(await confirmAction(...prompts[mode], true))) return;
    const auto = mode === "auto";
    run(auto ? "auto" : "merge",
      () => client().merge(projectPath, number, { method, sha: details.headSha, removeSourceBranch: removeSource, autoMerge: auto }),
      auto ? `Auto-merge programmé pour ${ref}` : `${ref} mergée`, !auto);
  }

  async function handleState(state: "open" | "closed") {
    if (state === "closed" && !(await confirmAction(`Fermer ${ref} sans merger ?`, undefined, true))) return;
    run("state", () => client().setState(projectPath, number, state), state === "closed" ? `${ref} fermée` : `${ref} rouverte`, true);
  }

  function handleUpdateBranch() {
    if (!details) return;
    run("update", () => client().updateBranch(projectPath, number, details.headSha),
      isGitHub ? "Branche mise à jour avec la cible" : "Rebase lancé sur GitLab");
  }

  function handleDraft(draft: boolean) {
    run("draft", () => client().setDraft(projectPath, number, draft),
      draft ? `${ref} repassée en brouillon` : `${ref} prête pour la relecture`, true);
  }

  async function requestClose() {
    if (pending) return;
    if (drafts.length && !(await confirmAction(
      "Abandonner la revue en cours ?",
      `${drafts.length} commentaire${drafts.length > 1 ? "s" : ""} en attente ne ser${drafts.length > 1 ? "ont" : "a"} pas publié${drafts.length > 1 ? "s" : ""}.`,
      true,
    ))) return;
    onClose();
  }

  const noun = isGitHub ? "Pull request" : "Merge request";
  const title = details ? `${details.pr.title} ${ref}` : `${noun} ${ref}`;

  return (
    <Modal
      title={title}
      onClose={requestClose}
      width={tab === "files" ? "w-[1100px]" : "w-[760px]"}
      height={tab === "files" ? "h-[76vh]" : ""}
      resizeKey="pull-request-review"
    >
      {loadError && <p className="p-4 text-xs text-red-400 break-words">{loadError}</p>}
      {!details && !loadError && <p className="p-4 text-xs text-[var(--color-muted)]">Chargement…</p>}
      {details && (
        <div className={`p-4 flex flex-col gap-4 ${tab === "files" ? "h-full" : ""}`}>
          <Header details={details} account={account} forgeName={forgeName} onCheckout={onCheckout && (() => onCheckout(details.pr))} />

<div className="flex gap-1 border-b border-overlay/10 -mx-4 px-4">
            <TabButton active={tab === "conversation"} onClick={() => setTab("conversation")}>
              Conversation ({comments.length})
            </TabButton>
            <TabButton active={tab === "files"} onClick={() => setTab("files")}>
              Fichiers modifiés{drafts.length ? ` · ${drafts.length} en attente` : ""}
            </TabButton>
          </div>

          {tab === "files" && !remoteName && (
            <p className="text-xs text-[var(--color-muted)] italic">
              Les fichiers modifiés se calculent dans le dépôt local : ouvre le dépôt de {projectPath} pour les voir.
            </p>
          )}
          {tab === "files" && remoteName && (
            <div className="-mx-4 -mb-4 flex-1 min-h-0">
              <PullRequestFiles
                account={account}
                projectPath={projectPath}
                remoteName={remoteName}
                details={details}
                drafts={drafts}
                onDraftsChange={setDrafts}
                onReviewed={load}
              />
            </div>
          )}

          {tab === "conversation" && (
            <>
            <People details={details} />

            {details.checks.length > 0 && <Checks checks={details.checks} />}

            <section className="flex flex-col gap-1">
              <h3 className={labelClass}>Description</h3>
              {details.description.trim()
                ? <p className="text-xs text-[var(--color-text)] whitespace-pre-wrap break-words font-mono bg-shade/20 rounded p-2">{details.description}</p>
                : <p className="text-xs text-[var(--color-muted)] italic">Aucune description</p>}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className={labelClass}>Conversation ({comments.length})</h3>
              {comments.map((c) => <Comment key={c.id} comment={c} />)}
              <textarea
                className={`${inputClass} h-20 resize-y font-mono`}
                placeholder="Commentaire (Markdown) — accompagne aussi l'approbation ou la demande de changements"
                {...fieldLabel("Commentaire de la conversation (Markdown)")}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendComment();
                }}
              />
              <ReviewActions
                details={details}
                account={account}
                hasReply={!!reply.trim()}
                pending={pending}
                onComment={sendComment}
                onReview={sendReview}
              />
            </section>

            {details.pr.state === "open" && remoteName && (
              <PullRequestBranchSync
                details={details}
                remoteName={remoteName}
                onCheckout={onCheckout && (() => onCheckout(details.pr))}
                onPushed={() => {
                  onChanged();
                  load();
                }}
              />
            )}

            {details.pr.state === "open" && (
              <MergeBox
                details={details}
                isGitHub={isGitHub}
                method={method}
                onMethod={setMethod}
                removeSource={removeSource}
                onRemoveSource={setRemoveSource}
                pending={pending}
                onMerge={handleMerge}
                onUpdateBranch={handleUpdateBranch}
                onClose={() => handleState("closed")}
              onDraft={handleDraft}
                onRefresh={() => run("refresh", async () => {}, "Statut actualisé")}
              />
            )}
            {details.pr.state === "closed" && (
              <div className="flex justify-end">
                <Button onClick={() => handleState("open")} disabled={!!pending}>Rouvrir</Button>
              </div>
            )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 text-xs border-b-2 -mb-px ${
        active ? "border-[var(--color-accent)] text-[var(--color-text)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Header({ details, account, forgeName, onCheckout }: {
  details: PullRequestDetails;
  account: ForgeAccount;
  forgeName: string;
  onCheckout?: () => void;
}) {
  const { pr } = details;
  const state = STATE_STYLES[pr.state];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)] min-w-0">
        <span className={`px-1.5 py-0.5 rounded font-semibold ${state.className}`}>{state.label}</span>
        {pr.draft && <span className="px-1.5 py-0.5 rounded border border-overlay/20">brouillon</span>}
        <span className="truncate">
          {pr.author} · {formatDate(pr.createdAt)} · {account.label}
        </span>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-xs text-[var(--color-text)] truncate">{pr.sourceBranch}</span>
        <ArrowRight size={12} className="text-[var(--color-muted)] shrink-0" />
        <span className="sr-only">vers</span>
        <span className="font-mono text-xs text-[var(--color-text)] truncate">{pr.targetBranch}</span>
        <div className="ml-auto flex gap-2 shrink-0">
          {pr.state === "open" && onCheckout && <Button onClick={onCheckout}>Checkout</Button>}
          <Button onClick={() => openUrl(pr.url)} title={`Ouvrir sur ${forgeName}`}>
            <span className="inline-flex items-center gap-1"><ExternalLink size={12} /> Ouvrir sur {forgeName}</span>
          </Button>
        </div>
      </div>
      {pr.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pr.labels.map((l) => (
            <span key={l} className="px-1.5 py-0.5 rounded bg-overlay/10 text-[10px] text-[var(--color-text)]">{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Relecteurs demandés et ayant donné un avis, avec leur verdict. */
function People({ details }: { details: PullRequestDetails }) {
  const { pr, approvedBy, changesRequestedBy, approvalsLeft, names } = details;
  const reviewers = [...new Set([...pr.reviewers, ...approvedBy, ...changesRequestedBy])];
  const verdict = (login: string) => {
    if (approvedBy.includes(login)) return <Check size={12} className="text-green-400" role="img" aria-label="a approuvé" />;
    if (changesRequestedBy.includes(login)) return <CircleX size={12} className="text-amber-400" role="img" aria-label="demande des changements" />;
    return <CircleDashed size={12} className="text-[var(--color-muted)]" role="img" aria-label="en attente" />;
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <section className="flex flex-col gap-1 min-w-0">
        <h3 className={labelClass}>Relecteurs{approvalsLeft ? ` · ${approvalsRequired(approvalsLeft)}` : ""}</h3>
        {reviewers.length === 0 && <span className="text-xs text-[var(--color-muted)] italic">Aucun</span>}
        {reviewers.map((login) => (
          <span key={login} title={login} className="flex items-center gap-1.5 text-xs text-[var(--color-text)]">{verdict(login)} {names[login] ?? login}</span>
        ))}
      </section>
      <section className="flex flex-col gap-1 min-w-0">
        <h3 className={labelClass}>Assignés</h3>
        {pr.assignees.length === 0 && <span className="text-xs text-[var(--color-muted)] italic">Aucun</span>}
        {pr.assignees.map((login) => <span key={login} title={login} className="text-xs text-[var(--color-text)]">{names[login] ?? login}</span>)}
      </section>
    </div>
  );
}

const approvalsRequired = (n: number) => (n > 1 ? `${n} approbations requises` : "1 approbation requise");

const CHECK_LABELS: Record<ForgeCheck["status"], string> = { success: "réussi", failure: "en échec", pending: "en cours", skipped: "ignoré" };

const CHECK_ICONS: Record<ForgeCheck["status"], React.ReactNode> = {
  success: <Check size={12} className="text-green-400 shrink-0" />,
  failure: <CircleX size={12} className="text-red-400 shrink-0" />,
  pending: <CircleDashed size={12} className="text-amber-300 shrink-0 animate-spin [animation-duration:3s]" />,
  skipped: <MinusCircle size={12} className="text-[var(--color-muted)] shrink-0" />,
};

function Checks({ checks }: { checks: ForgeCheck[] }) {
  const count = (status: ForgeCheck["status"]) => checks.filter((c) => c.status === status).length;
  const summary = [
    count("failure") && `${count("failure")} en échec`,
    count("pending") && `${count("pending")} en cours`,
    count("success") && `${count("success")} réussi${count("success") > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");
  return (
    <section className="flex flex-col gap-1">
      <h3 className={labelClass}>CI · {summary || "aucun résultat"}</h3>
      <ul className="flex flex-col max-h-36 overflow-y-auto rounded bg-shade/20 py-1">
        {checks.map((c, i) => {
          const content = (
            <>
              {CHECK_ICONS[c.status]}
              <span className="truncate">{c.name}</span>
              <span className="sr-only"> : {CHECK_LABELS[c.status]}</span>
            </>
          );
          const row = "flex items-center gap-2 px-2 py-0.5 text-left text-xs text-[var(--color-text)]";
          return (
            <li key={`${c.name}-${i}`}>
              {c.url ? (
                <button className={`${row} w-full hover:bg-overlay/5`} onClick={() => openUrl(c.url!)} title="Ouvrir le détail dans le navigateur">
                  {content}
                </button>
              ) : (
                <span className={row}>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Comment({ comment }: { comment: ForgeComment }) {
  return (
    <div className="rounded border border-overlay/10 bg-shade/20">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-overlay/5 text-[10px] text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-text)]">{comment.author}</span>
        {comment.review === "approved" && <span className="text-green-400">a approuvé</span>}
        {comment.review === "changes_requested" && <span className="text-amber-400">demande des changements</span>}
        <span className="ml-auto">{formatDate(comment.createdAt)}</span>
      </div>
      {comment.body && <p className="px-2 py-1.5 text-xs text-[var(--color-text)] whitespace-pre-wrap break-words">{comment.body}</p>}
    </div>
  );
}

function ReviewActions({ details, account, hasReply, pending, onComment, onReview }: {
  details: PullRequestDetails;
  account: ForgeAccount;
  hasReply: boolean;
  pending: string | null;
  onComment: () => void;
  onReview: (event: ReviewEvent) => void;
}) {
  const isGitHub = account.provider === "github";
  const open = details.pr.state === "open";
  // GitHub refuse qu'on approuve ou demande des changements sur sa propre PR.
  const canReview = open && !(isGitHub && details.pr.author === account.username);
  return (
    <div className="flex items-center justify-end gap-2">
      {canReview && isGitHub && (
        <Button
          onClick={() => onReview("request_changes")}
          disabled={!!pending || !hasReply}
          title={hasReply ? undefined : "Écris d'abord un commentaire expliquant les changements attendus"}
        >
          {pending === "request_changes" ? "Envoi…" : "Demander des changements"}
        </Button>
      )}
      {canReview && !isGitHub && details.approvedByMe && (
        <Button onClick={() => onReview("unapprove")} disabled={!!pending}>
          {pending === "unapprove" ? "Envoi…" : "Retirer mon approbation"}
        </Button>
      )}
      {canReview && !details.approvedByMe && (
        <Button onClick={() => onReview("approve")} disabled={!!pending}>
          <span className="inline-flex items-center gap-1"><Check size={12} /> {pending === "approve" ? "Envoi…" : "Approuver"}</span>
        </Button>
      )}
      <Button variant="primary" onClick={onComment} disabled={!!pending || !hasReply} title="Ctrl+Entrée">
        {pending === "comment" ? "Envoi…" : "Commenter"}
      </Button>
    </div>
  );
}

/** Merge normal, forcé malgré les exigences de la branche (GitHub), ou programmé à la réussite du pipeline (GitLab). */
type MergeMode = "merge" | "force" | "auto";

function MergeBox({ details, isGitHub, method, onMethod, removeSource, onRemoveSource, pending, onMerge, onUpdateBranch, onClose, onDraft, onRefresh }: {
  details: PullRequestDetails;
  isGitHub: boolean;
  method: MergeMethod;
  onMethod: (m: MergeMethod) => void;
  removeSource: boolean;
  onRemoveSource: (v: boolean) => void;
  pending: string | null;
  onMerge: (mode: MergeMode) => void;
  onUpdateBranch: () => void;
  onClose: () => void;
  onDraft: (draft: boolean) => void;
  onRefresh: () => void;
}) {
  const closeLabel = `Fermer la ${isGitHub ? "PR" : "MR"}`;
  const updateLabel = isGitHub ? "Mettre à jour la branche" : "Rebaser";
  const mergeLabel = details.canAutoMerge ? "Merger immédiatement" : "Merger";
  return (
    <section className="flex flex-col gap-2 rounded border border-overlay/10 p-3">
      <div className="flex items-center gap-2">
        <span className={`text-xs ${details.mergeable ? "text-green-300" : "text-amber-300"}`}>{details.mergeStatus}</span>
        <button
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
          onClick={onRefresh}
          disabled={!!pending}
          title="Actualiser le statut"
          aria-label="Actualiser le statut"
        >
          <RotateCw size={12} />
        </button>
        {details.canUpdateBranch && (
          <Button onClick={onUpdateBranch} disabled={!!pending}>
            {pending === "update" ? "Envoi…" : updateLabel}
          </Button>
        )}
        {details.pr.draft && (
          <Button variant="primary" onClick={() => onDraft(false)} disabled={!!pending}>
            {pending === "draft" ? "Envoi…" : "Marquer comme prête"}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {details.mergeMethods.length > 1 && (
          <select
            className={inputClass.replace("w-full", "w-auto")}
            value={method}
            onChange={(e) => onMethod(e.target.value as MergeMethod)}
            aria-label="Mode de merge"
          >
            {details.mergeMethods.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
        )}
        {!isGitHub && (
          <label className="flex items-center gap-2 text-xs text-[var(--color-text)] cursor-pointer">
            <input type="checkbox" checked={removeSource} onChange={(e) => onRemoveSource(e.target.checked)} />
            Supprimer la branche source
          </label>
        )}
        <div className="ml-auto flex gap-2">
          {!details.pr.draft && (
            <Button onClick={() => onDraft(true)} disabled={!!pending} title="Repasser en brouillon">
              {pending === "draft" ? "Envoi…" : "Repasser en brouillon"}
            </Button>
          )}
          <Button variant="danger" onClick={onClose} disabled={!!pending}>
            {pending === "state" ? "Fermeture…" : closeLabel}
          </Button>
          {details.canForceMerge && (
            <Button
              variant="danger"
              onClick={() => onMerge("force")}
              disabled={!!pending}
              title="Merger sans attendre les exigences de la branche (relectures, checks…) : tes droits permettent de les contourner"
            >
              {pending === "merge" ? "Merge…" : "Forcer le merge"}
            </Button>
          )}
          {details.canAutoMerge && (
            <Button onClick={() => onMerge("auto")} disabled={!!pending} title="Merger dès que le pipeline réussit">
              {pending === "auto" ? "Envoi…" : "Auto-merge"}
            </Button>
          )}
          {!details.canForceMerge && (
            <Button
              variant="primary"
              onClick={() => onMerge("merge")}
              disabled={!!pending || !details.mergeable}
              title={details.canAutoMerge ? "Merger maintenant, sans attendre la fin du pipeline" : undefined}
            >
              {pending === "merge" ? "Merge…" : mergeLabel}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
