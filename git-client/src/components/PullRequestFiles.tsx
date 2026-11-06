import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, List, ListTree, MessageSquare, RotateCw, Search, WrapText } from "lucide-react";
import { useRepoStore } from "../store/useRepoStore";
import { useUiStore } from "../store/useUiStore";
import { compareRefs, fetchRemote, getCompareFileDiff } from "../ipc/commands";
import { forgeClient } from "../api/forge";
import { errorMessage } from "../lib/actions";
import { indexComments, lineKeys, linePosition } from "../lib/reviewComments";
import { loadViewed, saveViewed } from "../lib/viewedFiles";
import { fileTree, visibleFiles, type FileNode } from "../lib/fileTree";
import type { CommitFile, DiffLine, FileDiff, RefComparison } from "../types/git";
import type {
  DraftComment, ForgeAccount, ForgeComment, LinePosition, PullRequestDetails, ReviewThread, ReviewVerdict,
} from "../types/forge";
import { DiffViewer, type DiffAnnotations } from "./DiffViewer";
import { Button, Modal, inputClass } from "./Modal";
import { isMobile, isPhone } from "../lib/platform";
import { fieldLabel } from "../lib/fieldLabel";
import { LineCounts } from "./CommitDetails";
import { MarkdownBody } from "./MarkdownBody";
import { EmojiTextarea } from "./EmojiAssist";
import { tr, trn, locale, LIST_SEPARATOR } from "../i18n";

const STATUS_LETTERS: Record<CommitFile["status"], { letter: string; label: string; color: string }> = {
  added: { letter: "A", label: tr("ajouté"), color: "text-green-400" },
  modified: { letter: "M", label: tr("modifié"), color: "text-yellow-400" },
  deleted: { letter: "D", label: tr("supprimé"), color: "text-red-400" },
  renamed: { letter: "R", label: tr("renommé"), color: "text-sky-300" },
  copied: { letter: "C", label: tr("copié"), color: "text-sky-300" },
  typechange: { letter: "T", label: tr("type changé"), color: "text-[var(--color-muted)]" },
};

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
const formatDate = (iso: string) => (iso ? dateFormat.format(new Date(iso)) : "");

let draftSeq = 0;

const TREE_KEY = "merathon.prFilesTree";

function loadTreeMode(): boolean {
  try {
    return localStorage.getItem(TREE_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveTreeMode(tree: boolean) {
  try {
    localStorage.setItem(TREE_KEY, tree ? "1" : "0");
  } catch {
    // stockage indisponible : mode gardé pour la session
  }
}

const WRAP_KEY = "merathon.diffWrap";

/** Mobile : lignes longues repliées par défaut, le défilement horizontal reste au choix. */
function loadWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveWrap(wrap: boolean) {
  try {
    localStorage.setItem(WRAP_KEY, wrap ? "1" : "0");
  } catch {
    // stockage indisponible : choix gardé pour la session
  }
}

const treePadding = (depth: number) => 8 + depth * 12;

/**
 * Diff d'une PR / MR calculé avec git en local (ancêtre commun de la cible → commit de tête), avec les fils de
 * commentaires de la forge sous leurs lignes, des commentaires à publier tout de suite ou à grouper dans une revue,
 * et le suivi des fichiers vus.
 */
export function PullRequestFiles({ account, projectPath, remoteName, details, drafts, onDraftsChange, onReviewed }: {
  account: ForgeAccount;
  projectPath: string;
  remoteName: string;
  details: PullRequestDetails;
  /** Commentaires en attente : gardés par le panneau pour survivre à un changement d'onglet. */
  drafts: DraftComment[];
  onDraftsChange: (drafts: DraftComment[]) => void;
  /** Une revue a été publiée : le détail (approbations…) doit être rechargé. */
  onReviewed: () => void;
}) {
  const { pr, headSha } = details;
  const isGitHub = account.provider === "github";
  const repoPath = useRepoStore((s) => s.repoPath);
  const notify = useUiStore((s) => s.notify);
  const [comparison, setComparison] = useState<RefComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ position: LinePosition; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [treeMode, setTreeMode] = useState(loadTreeMode);
  // Téléphone : la liste occupe l'écran, un fichier s'ouvre par-dessus dans sa propre fenêtre (le retour d'Android la ferme).
  // Tablette : liste et diff côte à côte, comme sur le bureau.
  const mobile = isPhone();
  const [fileOpen, setFileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [wrap, setWrap] = useState(loadWrap);

  const prKey = `${account.id}/${projectPath}/${pr.number}`;
  const [viewed, setViewed] = useState<Set<string>>(() => loadViewed(prKey, headSha));
  useEffect(() => setViewed(loadViewed(prKey, headSha)), [prKey, headSha]);

  const base = `${remoteName}/${pr.targetBranch}`;
  // Le commit de tête annoncé par la forge, à défaut la branche distante.
  const head = headSha || `${remoteName}/${pr.sourceBranch}`;
  const client = useMemo(() => forgeClient(account), [account]);
  const ctx = useMemo(() => ({ headSha, diffRefs: details.diffRefs }), [headSha, details.diffRefs]);

  const compare = useCallback(async (forceFetch: boolean) => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    const fetchFirst = async () => {
      useUiStore.getState().setBusy(tr("Fetch {remoteName}…", { remoteName }));
      try {
        await fetchRemote(repoPath, remoteName);
      } finally {
        useUiStore.getState().setBusy(null);
      }
    };
    try {
      if (forceFetch) await fetchFirst();
      let result: RefComparison;
      try {
        result = await compareRefs(repoPath, base, head);
      } catch (e) {
        if (forceFetch) throw e;
        await fetchFirst();
        result = await compareRefs(repoPath, base, head);
      }
      setComparison(result);
      setSelected((current) => (current && result.files.some((f) => f.path === current) ? current : result.files[0]?.path ?? null));
    } catch (e) {
      setComparison(null);
      // PR / MR fermée : sa branche a le plus souvent été supprimée, ses commits ne sont plus récupérables par un fetch.
      const after = pr.state === "merged" ? tr("le merge") : tr("la fermeture");
      const cause = pr.state === "open"
        ? tr("Une PR venant d'un fork n'est pas récupérée par ce fetch : ouvre-la dans le navigateur.")
        : tr("La branche {sourceBranch} a sans doute été supprimée après {after} : consulte les fichiers dans le navigateur.", { sourceBranch: pr.sourceBranch, after });
      setError(tr("Les commits de la branche {sourceBranch} sont introuvables après un fetch de {remoteName}. {cause} ({error})", { sourceBranch: pr.sourceBranch, remoteName, cause, error: errorMessage(e) }));
    } finally {
      setLoading(false);
    }
  }, [repoPath, remoteName, base, head, pr.sourceBranch, pr.state]);

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await client.getReviewThreads(projectPath, pr.number));
      setThreadsError(null);
    } catch (e) {
      setThreadsError(errorMessage(e));
    }
  }, [client, projectPath, pr.number]);

  useEffect(() => {
    compare(false);
  }, [compare]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!repoPath || !comparison || !selected || (mobile && !fileOpen)) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    getCompareFileDiff(repoPath, comparison.merge_base, comparison.head, selected)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setDiffLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repoPath, comparison, selected, mobile, fileOpen]);

  /** Exécute une action sur la forge puis recharge les fils. */
  async function act(fn: () => Promise<void>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      if (success) notify("success", success);
      await loadThreads();
      return true;
    } catch (e) {
      notify("error", errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const files = useMemo(() => comparison?.files ?? [], [comparison]);
  /** Ordre d'affichage, tous dossiers dépliés : sert à passer au fichier suivant. */
  const ordered = useMemo(
    () => (treeMode ? visibleFiles(fileTree(files, (f) => f.path), () => true) : files),
    [files, treeMode],
  );
  const selectedFile = files.find((f) => f.path === selected) ?? null;
  // Les positions viennent du diff local : il doit porter sur le commit que la forge connaît.
  const stale = !!comparison && !!headSha && comparison.head !== headSha;
  const canComment = !!comparison && !stale && (isGitHub || !!details.diffRefs);

  const commentCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of threads) counts.set(t.path, (counts.get(t.path) ?? 0) + t.comments.length);
    for (const d of drafts) counts.set(d.position.path, (counts.get(d.position.path) ?? 0) + 1);
    return counts;
  }, [threads, drafts]);

  const index = useMemo(
    () => (selected ? indexComments(selected, threads, drafts) : null),
    [selected, threads, drafts],
  );

  function toggleViewed(path: string) {
    const next = new Set(viewed);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      // Passe au fichier suivant pas encore vu.
      const after = ordered.slice(ordered.findIndex((f) => f.path === path) + 1).concat(ordered);
      const nextFile = after.find((f) => !next.has(f.path));
      if (path === selected && nextFile) setSelected(nextFile.path);
      // Mobile : dernier fichier vu, retour à la liste.
      else if (path === selected && mobile) setFileOpen(false);
    }
    setViewed(next);
    saveViewed(prKey, headSha, next);
  }

  // Rappels stables pour la liste mémoïsée : la dernière version de toggleViewed est lue au moment du clic.
  const toggleViewedRef = useRef(toggleViewed);
  useLayoutEffect(() => {
    toggleViewedRef.current = toggleViewed;
  });
  const onToggleViewed = useCallback((path: string) => toggleViewedRef.current(path), []);

  const openFile = useCallback((path: string) => {
    setSelected(path);
    setFileOpen(true);
  }, []);

  const toggleTreeMode = useCallback(() => {
    setTreeMode(!treeMode);
    saveTreeMode(!treeMode);
  }, [treeMode]);

  // Stable tant que le fichier affiché ne change pas : les lignes du diff mémoïsées ne sont pas re-rendues.
  const startComment = useCallback((line: DiffLine) => {
    if (!selectedFile) return;
    const position = linePosition(line, selectedFile.path, selectedFile.old_path);
    if (position) setComposing({ position, text: "" });
  }, [selectedFile]);

  function addDraft() {
    if (!composing?.text.trim()) return;
    draftSeq += 1;
    onDraftsChange([...drafts, { id: `draft-${Date.now()}-${draftSeq}`, position: composing.position, body: composing.text.trim() }]);
    setComposing(null);
  }

  async function publishNow() {
    if (!composing?.text.trim()) return;
    const { position, text } = composing;
    if (await act(() => client.addLineComment(projectPath, pr.number, ctx, position, text.trim()), tr("Commentaire publié"))) {
      setComposing(null);
    }
  }

  function editDraft(draft: DraftComment) {
    onDraftsChange(drafts.filter((d) => d.id !== draft.id));
    setComposing({ position: draft.position, text: draft.body });
  }

  const annotations: DiffAnnotations | undefined = index
    ? {
      onComment: canComment ? startComment : undefined,
      below: (line) => {
        const keys = lineKeys(line);
        const lineThreads = keys.flatMap((k) => index.threadsByLine.get(k) ?? []);
        const lineDrafts = keys.flatMap((k) => index.draftsByLine.get(k) ?? []);
        // Mobile : le formulaire s'ouvre en bas de l'écran, pas sous la ligne.
        const composingHere = !mobile && composing && composing.position.path === selected
          && keys.includes(`${composing.position.side}:${composing.position.line}`);
        if (!lineThreads.length && !lineDrafts.length && !composingHere) return null;
        return (
          <div className="sticky left-3 max-w-[640px] flex flex-col gap-2">
            {lineThreads.map((t) => (
              <Thread
                key={t.id}
                thread={t}
                prUrl={pr.url}
                busy={busy}
                onReply={(body) => act(() => client.replyToThread(projectPath, pr.number, t, body), tr("Réponse publiée"))}
                onResolve={(resolved) => act(() => client.resolveThread(projectPath, pr.number, t, resolved), resolved ? tr("Fil résolu") : tr("Fil rouvert"))}
              />
            ))}
            {lineDrafts.map((d) => (
              <DraftCard key={d.id} draft={d} prUrl={pr.url} onEdit={() => editDraft(d)} onDelete={() => onDraftsChange(drafts.filter((x) => x.id !== d.id))} />
            ))}
            {composingHere && composing && (
              <Composer
                text={composing.text}
                busy={busy}
                onChange={(text) => setComposing({ ...composing, text })}
                onCancel={() => setComposing(null)}
                onDraft={addDraft}
                onPublish={publishNow}
              />
            )}
          </div>
        );
      },
    }
    : undefined;

  const outdated = index && index.outdated.length > 0 && (
    <div className="px-3 py-2 border-b border-overlay/5 flex flex-col gap-2 max-h-48 overflow-y-auto">
      <span className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
        {tr("Commentaires sur une version précédente")}
      </span>
      {index.outdated.map((t) => (
        <Thread
          key={t.id}
          thread={t}
          prUrl={pr.url}
          busy={busy}
          onReply={(body) => act(() => client.replyToThread(projectPath, pr.number, t, body), tr("Réponse publiée"))}
          onResolve={(resolved) => act(() => client.resolveThread(projectPath, pr.number, t, resolved), resolved ? tr("Fil résolu") : tr("Fil rouvert"))}
        />
      ))}
    </div>
  );

  if (!repoPath) return <p className="p-4 text-xs text-[var(--color-muted)] italic">{tr("Aucun dépôt ouvert")}</p>;

  const totals = files.reduce((t, f) => ({ add: t.add + f.additions, del: t.del + f.deletions }), { add: 0, del: 0 });
  const viewedCount = files.filter((f) => viewed.has(f.path)).length;

  return (
    <div className="flex flex-col h-full min-h-[240px]">
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-overlay/10 text-[11px] text-[var(--color-muted)] ${mobile ? "flex-wrap" : ""}`}>
        {loading && <span>{tr("Calcul du diff…")}</span>}
        {!loading && comparison && (
          <span className="truncate">
            {trn(comparison.commits, "{n} commit", "{n} commits")} · {trn(files.length, "{n} fichier", "{n} fichiers")} ·{" "}
            <LineCounts add={totals.add} del={totals.del} all />{" "}
            {mobile
              ? tr("· vus {viewedCount}/{length}", { viewedCount, length: files.length })
              : <>{tr("· vus {viewedCount}/{length} · base", { viewedCount, length: files.length })}{" "}<span className="font-mono">{comparison.merge_base.slice(0, 7)}</span> ({base})</>}
          </span>
        )}
        {stale && <span className="text-amber-300 shrink-0">{tr("tête locale différente de la forge : fetch pour commenter")}</span>}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {drafts.length > 0 && (
            <Button variant="primary" onClick={() => setSubmitOpen((v) => !v)}>
              {tr("Terminer la revue ({length})", { length: drafts.length })}
            </Button>
          )}
          {drafts.length === 0 && canComment && (
            <button className="hover:text-[var(--color-text)]" onClick={() => setSubmitOpen((v) => !v)}>
              {tr("Publier une revue…")}
            </button>
          )}
          <button
            className="hover:text-[var(--color-text)] disabled:opacity-40"
            disabled={loading}
            onClick={() => {
              compare(true);
              loadThreads();
            }}
            title={tr("Fetch {remoteName} puis recalculer", { remoteName })}
          >
            <RotateCw size={11} className="inline mr-1 -mt-0.5" />Fetch
          </button>
        </div>
      </div>
      {submitOpen && (
        <SubmitReview
          account={account}
          details={details}
          drafts={drafts}
          onCancel={() => setSubmitOpen(false)}
          onSubmit={async (verdict, body) => {
            setBusy(true);
            try {
              const result = await client.submitReview(projectPath, pr.number, ctx, { verdict, body, comments: drafts });
              const published = new Set(result.publishedIds);
              onDraftsChange(drafts.filter((d) => !published.has(d.id)));
              if (result.errors.length) notify("error", tr("Revue publiée en partie : {list}", { list: result.errors.join(LIST_SEPARATOR) }));
              else {
                notify("success", tr("Revue publiée"));
                setSubmitOpen(false);
              }
              await loadThreads();
              onReviewed();
            } catch (e) {
              notify("error", errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}
      {error && <p className="px-4 py-2 text-xs text-red-400 break-words">{error}</p>}
      {threadsError && <p className="px-4 py-1 text-xs text-amber-300 break-words">{tr("Commentaires de ligne indisponibles : {threadsError}", { threadsError })}</p>}
      {comparison && mobile && (
        <div className="flex flex-1 min-h-0">
          <FileList
            mobile
            files={files}
            treeMode={treeMode}
            onToggleTreeMode={toggleTreeMode}
            selected={null}
            viewed={viewed}
            commentCount={commentCount}
            onSelect={openFile}
            onToggleViewed={onToggleViewed}
          />
        </div>
      )}
      {mobile && fileOpen && selectedFile && (() => {
        const position = ordered.findIndex((f) => f.path === selectedFile.path);
        const go = (delta: number) => {
          const target = ordered[position + delta];
          if (target) setSelected(target.path);
        };
        const composingLine = composing && composing.position.path === selectedFile.path ? composing : null;
        const isViewed = viewed.has(selectedFile.path);
        const slash = selectedFile.path.lastIndexOf("/");
        return (
          <Modal
            title={selectedFile.path.slice(slash + 1)}
            onClose={() => {
              setFileOpen(false);
              setSearchOpen(false);
            }}
            width="w-screen"
            height="h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-16px)]"
          >
            <div className="h-full flex flex-col">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-overlay/10 text-[11px] text-[var(--color-muted)]">
                <span className="font-mono truncate flex-1 min-w-0">{slash > 0 ? selectedFile.path.slice(0, slash) : ""}</span>
                <span className="shrink-0 font-mono"><LineCounts add={selectedFile.additions} del={selectedFile.deletions} /></span>
                <span className="shrink-0 tabular-nums">{position + 1}/{ordered.length}</span>
                <IconToggle
                  pressed={wrap}
                  label={tr("Retour à la ligne des lignes longues")}
                  onClick={() => {
                    setWrap(!wrap);
                    saveWrap(!wrap);
                  }}
                >
                  <WrapText size={15} />
                </IconToggle>
                <IconToggle pressed={searchOpen} label={tr("Rechercher dans le fichier")} onClick={() => setSearchOpen(!searchOpen)}>
                  <Search size={15} />
                </IconToggle>
              </div>
              {outdated}
              <div className="flex-1 min-h-0">
                <DiffViewer
                  key={selectedFile.path}
                  diff={diff}
                  loading={diffLoading}
                  annotations={annotations}
                  searchable={searchOpen}
                  compact={{ wrap }}
                />
              </div>
              {composingLine ? (
                <div className="px-3 py-2 border-t border-overlay/10 bg-shade/20 flex flex-col gap-1.5">
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {tr("Commentaire sur la ligne {line}", { line: composingLine.position.line })}
                  </span>
                  <Composer
                    text={composingLine.text}
                    busy={busy}
                    onChange={(text) => setComposing({ ...composingLine, text })}
                    onCancel={() => setComposing(null)}
                    onDraft={addDraft}
                    onPublish={publishNow}
                  />
                </div>
              ) : (
                <div className="flex items-stretch gap-2 px-3 py-2 border-t border-overlay/10">
                  <BarButton label={tr("Fichier précédent")} disabled={position <= 0} onClick={() => go(-1)}>
                    <ChevronLeft size={18} />
                  </BarButton>
                  <button
                    type="button"
                    aria-pressed={isViewed}
                    onClick={() => toggleViewed(selectedFile.path)}
                    className={`flex-1 min-h-11 rounded-md text-sm font-semibold inline-flex items-center justify-center gap-1.5 ${
                      isViewed ? "bg-overlay/10 text-[var(--color-text)]" : "bg-[var(--color-accent-solid)] text-white"
                    }`}
                  >
                    {isViewed ? <><Check size={16} />{tr("Vu")}</> : <>{tr("Vu, suivant")}<ChevronRight size={16} /></>}
                  </button>
                  <BarButton label={tr("Fichier suivant")} disabled={position >= ordered.length - 1} onClick={() => go(1)}>
                    <ChevronRight size={18} />
                  </BarButton>
                </div>
              )}
            </div>
          </Modal>
        );
      })()}
      {comparison && !mobile && (
        <div className="flex flex-1 min-h-0">
          <FileList
            files={files}
            treeMode={treeMode}
            onToggleTreeMode={toggleTreeMode}
            selected={selected}
            viewed={viewed}
            commentCount={commentCount}
            onSelect={setSelected}
            onToggleViewed={onToggleViewed}
          />
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedFile && (
              <div className="flex items-center gap-2 px-3 py-1 border-b border-overlay/5 text-[11px]">
                <span className="font-mono text-[var(--color-muted)] truncate">{selectedFile.path}</span>
                <label className="ml-auto flex items-center gap-1 shrink-0 text-[var(--color-text)] cursor-pointer">
                  <input type="checkbox" checked={viewed.has(selectedFile.path)} onChange={() => toggleViewed(selectedFile.path)} />
                  {tr("Vu")}
                </label>
              </div>
            )}
            {outdated}
            <div className="flex-1 min-h-0">
              <DiffViewer diff={diff} loading={diffLoading} annotations={annotations} searchable />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Colonne des fichiers : recherche sur le chemin, liste ou arborescence. La recherche et les dossiers repliés vivent ici :
 * taper dans le champ ne re-rend pas le diff.
 */
const FileList = memo(function FileList({ mobile = false, files, treeMode, onToggleTreeMode, selected, viewed, commentCount, onSelect, onToggleViewed }: {
  /** Pleine largeur, lignes hautes faciles à toucher. */
  mobile?: boolean;
  files: CommitFile[];
  treeMode: boolean;
  onToggleTreeMode: () => void;
  selected: string | null;
  viewed: Set<string>;
  commentCount: Map<string, number>;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  /** Dossiers repliés de l'arborescence. */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const q = query.trim().toLowerCase();
  const shownFiles = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  // Pendant une recherche, tous les dossiers sont dépliés pour montrer chaque résultat.
  const isOpen = (path: string) => !!q || !collapsed.has(path);

  function toggleFolder(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  }

  const row = (f: CommitFile, depth?: number) => (
    <FileRow
      key={f.path}
      file={f}
      depth={depth}
      selected={selected === f.path}
      mobile={mobile}
      viewed={viewed.has(f.path)}
      comments={commentCount.get(f.path) ?? 0}
      onSelect={onSelect}
      onToggleViewed={onToggleViewed}
    />
  );

  return (
      <div className={mobile ? "flex-1 min-w-0 flex flex-col" : "w-64 shrink-0 flex flex-col border-r border-overlay/10"}>
        <div className="flex items-center gap-1 p-1.5 border-b border-overlay/5">
          <div className="relative flex-1 min-w-0">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" aria-hidden />
            <input
              type="search"
              className={`${inputClass} pl-6! py-1!`}
              placeholder={tr("Rechercher un fichier…")}
              {...fieldLabel(tr("Rechercher un fichier"))}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Échap vide la recherche avant de fermer la fenêtre.
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </div>
          <button
            className="w-6 h-6 shrink-0 inline-flex items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
            onClick={onToggleTreeMode}
            aria-label={treeMode ? tr("Afficher en liste") : tr("Afficher en arborescence")}
            title={treeMode ? tr("Afficher en liste") : tr("Afficher en arborescence")}
          >
            {treeMode ? <List size={12} /> : <ListTree size={12} />}
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {files.length === 0 && <li className="px-3 py-1 text-xs text-[var(--color-muted)] italic">{tr("Aucun fichier modifié")}</li>}
          {files.length > 0 && shownFiles.length === 0 && (
            <li className="px-3 py-1 text-xs text-[var(--color-muted)] italic">{tr("Aucun fichier ne correspond")}</li>
          )}
          {treeMode
            ? <FileTree nodes={fileTree(shownFiles, (f) => f.path)} depth={0} isOpen={isOpen} onToggle={toggleFolder} viewed={viewed} row={row} mobile={mobile} />
            : shownFiles.map((f) => row(f))}
        </ul>
      </div>
  );
});

/** Dossiers pliables ; chaque dossier indique combien de ses fichiers ont été vus. */
function FileTree({ nodes, depth, isOpen, onToggle, viewed, row, mobile }: {
  mobile: boolean;
  nodes: FileNode<CommitFile>[];
  depth: number;
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  viewed: Set<string>;
  row: (f: CommitFile, depth: number) => React.ReactNode;
}) {
  return nodes.map((node) => {
    if (node.kind === "file") return row(node.item, depth);
    const open = isOpen(node.path);
    const seen = node.files.filter((f) => viewed.has(f.path)).length;
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
      <li key={`folder:${node.path}`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(node.path)}
          title={node.path}
          className={`w-full flex items-center gap-1 pr-2 ${mobile ? "min-h-10" : "py-[3px]"} text-left hover:bg-overlay/5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/60`}
          style={{ paddingLeft: treePadding(depth) }}
        >
          <Chevron size={11} className="w-3 shrink-0 text-[var(--color-muted)]" />
          <span className="flex-1 truncate text-[11px] font-mono text-[var(--color-muted)]">
            <span className="sr-only">{tr("Dossier")}{" "}</span>
            {node.name}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
            {seen}/{node.files.length}<span className="sr-only">{" "}{tr("vus")}</span>
          </span>
        </button>
        {open && (
          <ul>
            <FileTree nodes={node.children} depth={depth + 1} isOpen={isOpen} onToggle={onToggle} viewed={viewed} row={row} mobile={mobile} />
          </ul>
        )}
      </li>
    );
  });
}

/** Ligne d'un fichier ; avec `depth` (arborescence), en retrait, sinon avec son dossier. */
const FileRow = memo(function FileRow({ file, depth, selected, mobile, viewed, comments, onSelect, onToggleViewed }: {
  file: CommitFile;
  /** Ligne haute, nom au-dessus de son dossier. */
  mobile: boolean;
  depth?: number;
  selected: boolean;
  viewed: boolean;
  comments: number;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
}) {
  const status = STATUS_LETTERS[file.status];
  const slash = file.path.lastIndexOf("/");
  const dir = depth === undefined && slash > 0 ? file.path.slice(0, slash) : "";
  return (
    <li>
      <div
        className={`flex items-center gap-2 pr-2 ${mobile ? "min-h-12 py-1.5 text-sm" : "py-[3px] text-xs"} ${selected ? "bg-[var(--color-accent)]/20" : "hover:bg-overlay/5"}`}
        style={{ paddingLeft: depth === undefined ? 8 : treePadding(depth) + 16 }}
        title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}
      >
        <input
          type="checkbox"
          checked={viewed}
          onChange={() => onToggleViewed(file.path)}
          className={mobile ? "w-5 h-5 shrink-0" : undefined}
          aria-label={tr("Marquer {path} comme vu", { path: file.path })}
        />
        {/* Fichier vu : nom en gris (sans transparence, qui ferait chuter le contraste) et case cochée. */}
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          onClick={() => onSelect(file.path)}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]/60 rounded"
        >
          <span className={`w-3 shrink-0 font-mono font-bold ${status.color}`} aria-hidden>{status.letter}</span>
          <span className={`flex-1 min-w-0 flex ${mobile ? "flex-col" : "items-baseline gap-1.5"}`}>
            <span className={`truncate shrink-0 max-w-full ${viewed ? "text-[var(--color-muted)]" : "text-[var(--color-text)]"}`}>{file.path.slice(slash + 1)}</span>
            {dir && <span className="truncate text-[10px] font-mono text-[var(--color-muted)]">{dir}</span>}
          </span>
          <span className="sr-only">, {status.label}{viewed ? ", vu" : ""}, </span>
          {comments > 0 && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-[var(--color-muted)]">
              <MessageSquare size={10} /> <span aria-hidden>{comments}</span>
              <span className="sr-only">{trn(comments, "{n} commentaire", "{n} commentaires")}, </span>
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px]">
            <LineCounts add={file.additions} del={file.deletions} all />
          </span>
        </button>
      </div>
    </li>
  );
});

function CommentBody({ comment, prUrl }: { comment: ForgeComment; prUrl: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-text)]">{comment.author}</span>
        <span>{formatDate(comment.createdAt)}</span>
      </div>
      <MarkdownBody text={comment.body} prUrl={prUrl} />
    </div>
  );
}

/** Fil de discussion d'une ligne ; un fil résolu est replié. */
function Thread({ thread, prUrl, busy, onReply, onResolve }: {
  thread: ReviewThread;
  prUrl: string;
  busy: boolean;
  onReply: (body: string) => Promise<boolean>;
  onResolve: (resolved: boolean) => void;
}) {
  const [open, setOpen] = useState(!thread.resolved);
  const [reply, setReply] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        className="self-start text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        onClick={() => setOpen(true)}
      >
        <Check size={11} className="inline mr-1 -mt-0.5" />{tr("Fil résolu · {count} — afficher", { count: trn(thread.comments.length, "{n} commentaire", "{n} commentaires") })}
      </button>
    );
  }

  return (
    <div className="rounded border border-overlay/10 bg-[var(--color-bg-elevated)] p-2 flex flex-col gap-2">
      {thread.comments.map((c) => <CommentBody key={c.id} comment={c} prUrl={prUrl} />)}
      {reply !== null ? (
        <div className="flex flex-col gap-1">
          <EmojiTextarea
            autoFocus
            className={`${inputClass} h-16 resize-y font-mono`}
            value={reply}
            onChange={setReply}
            placeholder={tr("Réponse (Markdown)")}
            {...fieldLabel(tr("Réponse au commentaire (Markdown)"))}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setReply(null)} disabled={busy}>{tr("Annuler")}</Button>
            <Button
              variant="primary"
              disabled={busy || !reply.trim()}
              onClick={async () => {
                if (await onReply(reply.trim())) setReply(null);
              }}
            >
              {tr("Répondre")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[11px]">
          <button className="text-[var(--color-accent-text)] hover:underline" onClick={() => setReply("")}>{tr("Répondre")}</button>
          {thread.resolved !== null && (
            <button
              className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
              disabled={busy}
              onClick={() => onResolve(!thread.resolved)}
            >
              {thread.resolved ? tr("Rouvrir le fil") : tr("Résoudre")}
            </button>
          )}
          {thread.resolved && (
            <button className="text-[var(--color-muted)] hover:text-[var(--color-text)]" onClick={() => setOpen(false)}>{tr("Replier")}</button>
          )}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft, prUrl, onEdit, onDelete }: { draft: DraftComment; prUrl: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="rounded border border-dashed border-[var(--color-accent)]/50 bg-[var(--color-bg-elevated)] p-2 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="px-1 rounded bg-[var(--color-accent)]/30 text-[var(--color-text)]">{tr("en attente")}</span>
        <button className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-text)]" onClick={onEdit}>{tr("Modifier")}</button>
        <button className="text-red-300 hover:text-red-200" onClick={onDelete}>{tr("Supprimer")}</button>
      </div>
      <MarkdownBody text={draft.body} prUrl={prUrl} />
    </div>
  );
}

function Composer({ text, busy, onChange, onCancel, onDraft, onPublish }: {
  text: string;
  busy: boolean;
  onChange: (text: string) => void;
  onCancel: () => void;
  onDraft: () => void;
  onPublish: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <EmojiTextarea
        autoFocus
        className={`${inputClass} h-20 resize-y font-mono`}
        placeholder={isMobile() ? tr("Commentaire sur la ligne (Markdown)") : tr("Commentaire (Markdown) · Ctrl+Entrée : ajouter à la revue")}
        {...fieldLabel(tr("Commentaire sur la ligne (Markdown)"))}
        value={text}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onDraft();
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>{tr("Annuler")}</Button>
        <Button onClick={onPublish} disabled={busy || !text.trim()} title={tr("Publier ce seul commentaire")}>
          {tr("Commenter maintenant")}
        </Button>
        <Button variant="primary" onClick={onDraft} disabled={busy || !text.trim()}>{tr("Ajouter à la revue")}</Button>
      </div>
    </div>
  );
}

/** Publication d'une revue : commentaire général, avis et commentaires en attente. */
function SubmitReview({ account, details, drafts, busy, onCancel, onSubmit }: {
  account: ForgeAccount;
  details: PullRequestDetails;
  drafts: DraftComment[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (verdict: ReviewVerdict, body: string) => void;
}) {
  const isGitHub = account.provider === "github";
  // GitHub refuse un avis sur sa propre PR ; GitLab n'a pas de demande de changements.
  const ownPr = isGitHub && details.pr.author === account.username;
  const verdicts: { value: ReviewVerdict; label: string }[] = [
    { value: "comment", label: tr("Commenter") },
    ...(!ownPr && !details.approvedByMe ? [{ value: "approve" as const, label: tr("Approuver") }] : []),
    ...(isGitHub && !ownPr ? [{ value: "request_changes" as const, label: tr("Demander des changements") }] : []),
  ];
  const [verdict, setVerdict] = useState<ReviewVerdict>("comment");
  const [body, setBody] = useState("");
  const missingBody = verdict === "request_changes" && !body.trim();
  const empty = verdict === "comment" && !body.trim() && drafts.length === 0;

  return (
    <div className="px-4 py-3 border-b border-overlay/10 bg-shade/20 flex flex-col gap-2">
      <EmojiTextarea
        autoFocus
        className={`${inputClass} h-16 resize-y font-mono`}
        placeholder={tr("Commentaire général de la revue (Markdown, facultatif)")}
        {...fieldLabel(tr("Commentaire général de la revue (Markdown, facultatif)"))}
        value={body}
        onChange={setBody}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-text)]">
        {verdicts.map((v) => (
          <label key={v.value} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="review-verdict" checked={verdict === v.value} onChange={() => setVerdict(v.value)} />
            {v.label}
          </label>
        ))}
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">{tr("{count} en attente", { count: trn(drafts.length, "{n} commentaire", "{n} commentaires") })}</span>
        <Button onClick={onCancel} disabled={busy}>{tr("Fermer")}</Button>
        <Button
          variant="primary"
          disabled={busy || missingBody || empty}
          title={missingBody ? tr("Explique les changements attendus") : undefined}
          onClick={() => onSubmit(verdict, body.trim())}
        >
          {busy ? tr("Publication…") : tr("Publier la revue")}
        </Button>
      </div>
      {!isGitHub && drafts.length > 0 && (
        <p className="text-[10px] text-[var(--color-muted)]">
          {tr("GitLab publie les commentaires un par un : en cas d'échec, ceux qui n'ont pas pu être publiés restent en attente.")}
        </p>
      )}
    </div>
  );
}

/** Bouton d'icône à deux états de la barre d'un fichier (mobile). */
function IconToggle({ pressed, label, onClick, children }: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-md ${
        pressed ? "bg-[var(--color-accent)]/25 text-[var(--color-text)]" : "text-[var(--color-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

/** Bouton précédent / suivant de la barre du bas (mobile), à portée de pouce. */
function BarButton({ label, disabled, onClick, children }: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="w-12 min-h-11 shrink-0 inline-flex items-center justify-center rounded-md bg-overlay/10 text-[var(--color-text)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}
