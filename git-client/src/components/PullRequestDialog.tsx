import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRepoStore } from "../store/useRepoStore";
import { confirmAction, useUiStore } from "../store/useUiStore";
import { forgeClient } from "../api/forge";
import { push } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { pullRequestTitle } from "../lib/branches";
import type { ForgeAccount, ForgeMilestone, ForgeUser, PrTemplate, PullRequestOptions } from "../types/forge";
import { Button, Modal, inputClass } from "./Modal";

/** Pull request à préparer : branche source, projet visé et, pour une branche locale, de quoi la pousser avant. */
export interface PullRequestTarget {
  account: ForgeAccount;
  /** Chemin du projet sur la forge : "owner/repo" ou "group/sub/repo". */
  projectPath: string;
  /** Remote local correspondant au projet. */
  remoteName: string;
  /** Nom de la branche sur le remote. */
  sourceBranch: string;
  /** Branche locale à pousser avant la création (absente pour une branche distante). */
  localBranch?: string;
  /** La branche locale n'est pas publiée ou a des commits en avance. */
  needsPush?: boolean;
}

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]";

export function PullRequestDialog({ target, onClose }: { target: PullRequestTarget; onClose: () => void }) {
  const { account, projectPath, remoteName, sourceBranch } = target;
  const isGitHub = account.provider === "github";
  const noun = isGitHub ? "pull request" : "merge request";
  const forgeName = isGitHub ? "GitHub" : "GitLab";
  const repoPath = useRepoStore((s) => s.repoPath);
  const branches = useRepoStore((s) => s.branches);
  const notify = useUiStore((s) => s.notify);

  const [options, setOptions] = useState<PullRequestOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetBranch, setTargetBranch] = useState("");
  const [title, setTitle] = useState(() => pullRequestTitle(sourceBranch));
  const [description, setDescription] = useState("");
  const [templates, setTemplates] = useState<PrTemplate[]>([]);
  /** Modèle choisi ("" : aucun). */
  const [templateName, setTemplateName] = useState("");
  /** Description à jour, lue à l'arrivée des modèles : on ne remplace pas ce qui a déjà été saisi. */
  const descriptionRef = useRef(description);
  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);
  const [draft, setDraft] = useState(false);
  const [assignees, setAssignees] = useState<ForgeUser[]>([]);
  const [reviewers, setReviewers] = useState<ForgeUser[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [milestone, setMilestone] = useState<ForgeMilestone | null>(null);
  const [squash, setSquash] = useState(false);
  const [removeSource, setRemoveSource] = useState(false);
  const [pushFirst, setPushFirst] = useState(!!target.needsPush);
  const [openAfter, setOpenAfter] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    forgeClient(account)
      .getPullRequestOptions(projectPath)
      .then((o) => {
        if (cancelled) return;
        setOptions(o);
        setTargetBranch((current) => current || o.defaultBranch);
        setSquash(o.squashDefault);
        setRemoveSource(o.removeSourceBranchDefault);
      })
      .catch((e) => !cancelled && setLoadError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [account, projectPath]);

  // Modèle de description du projet : celui que la forge applique d'office pré-remplit la description, si elle est vide.
  useEffect(() => {
    let cancelled = false;
    forgeClient(account)
      .getPullRequestTemplates(projectPath)
      .then(({ templates: list, defaultName }) => {
        if (cancelled) return;
        setTemplates(list);
        const initial = list.find((t) => t.name === defaultName);
        if (!initial || descriptionRef.current.trim()) return;
        setTemplateName(initial.name);
        setDescription(initial.content);
      })
      .catch(() => {}); // sans modèle, la description reste libre
    return () => {
      cancelled = true;
    };
  }, [account, projectPath]);

  /** Applique un modèle ; une description déjà modifiée n'est remplacée qu'après confirmation. */
  async function chooseTemplate(name: string) {
    const current = templates.find((t) => t.name === templateName)?.content ?? "";
    if (description.trim() && description !== current && !(await confirmAction(
      "Remplacer la description ?",
      "La description saisie sera remplacée par le modèle choisi.",
      true,
    ))) return;
    setTemplateName(name);
    setDescription(templates.find((t) => t.name === name)?.content ?? "");
  }

  // Branches cibles : celles du remote connues localement, plus la branche par défaut du projet.
  const targetBranches = useMemo(() => {
    const prefix = `${remoteName}/`;
    const names = branches
      .filter((b) => b.is_remote && b.name.startsWith(prefix))
      .map((b) => b.name.slice(prefix.length))
      .filter((n) => n !== "HEAD" && n !== sourceBranch);
    if (options && !names.includes(options.defaultBranch)) names.unshift(options.defaultBranch);
    return names;
  }, [branches, remoteName, sourceBranch, options]);

  // On ne se demande pas soi-même en relecture sur GitHub (refusé par l'API).
  const reviewerChoices = useMemo(
    () => (options?.users ?? []).filter((u) => !isGitHub || u.username !== account.username),
    [options, isGitHub, account.username],
  );

  const canCreate = !creating && !!title.trim() && !!targetBranch && targetBranch !== sourceBranch;

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    try {
      if (pushFirst && target.localBranch && repoPath) {
        useUiStore.getState().setBusy("Push…");
        try {
          await push(repoPath, { branch: target.localBranch, remote: remoteName });
        } finally {
          useUiStore.getState().setBusy(null);
        }
        useRepoStore.getState().refresh().catch(() => {});
      }
      const { pr, warnings } = await forgeClient(account).createPullRequest(projectPath, {
        sourceBranch,
        targetBranch,
        title: title.trim(),
        description,
        draft,
        assignees,
        reviewers,
        labels,
        milestone,
        squash,
        removeSourceBranch: removeSource,
      });
      const ref = isGitHub ? `#${pr.number}` : `!${pr.number}`;
      notify("success", `${isGitHub ? "Pull request" : "Merge request"} ${ref} créée`);
      if (warnings.length) notify("error", `${ref} créée, mais échec pour ${warnings.join(" ; ")}`);
      if (openAfter && pr.url) openUrl(pr.url);
      onClose();
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title={`Nouvelle ${noun} ${forgeName}`} onClose={() => !creating && onClose()} width="w-[620px]">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <span className="px-1.5 py-0.5 rounded bg-overlay/10 text-[var(--color-text)] font-semibold">{forgeName}</span>
          <span className="font-mono truncate">{projectPath}</span>
          <span className="ml-auto truncate">{account.label}</span>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 flex-1 min-w-0">
            <span className={labelClass}>Branche source</span>
            <input className={`${inputClass} font-mono`} readOnly value={sourceBranch} />
          </label>
          <span className="pb-1.5 text-[var(--color-muted)]">→</span>
          <label className="flex flex-col gap-1 flex-1 min-w-0">
            <span className={labelClass}>Branche cible</span>
            <select className={`${inputClass} font-mono`} value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)}>
              {!targetBranch && <option value="">Chargement…</option>}
              {targetBranches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Titre</span>
          <input autoFocus className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={labelClass}>Description (Markdown)</span>
            {templates.length > 0 && (
              <div className="ml-auto w-56 shrink-0">
                <select
                  className={`${inputClass} text-[11px]`}
                  value={templateName}
                  onChange={(e) => chooseTemplate(e.target.value)}
                  aria-label="Modèle de description"
                  title="Modèles de description définis dans le projet"
                >
                  <option value="">Sans modèle</option>
                  {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <textarea
            aria-label="Description"
            className={`${inputClass} ${templateName ? "h-56" : "h-28"} resize-y font-mono`}
            placeholder="Contexte, changements, comment tester…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {loadError && (
          <p className="text-[11px] text-amber-300 break-words">
            Membres, labels et jalons indisponibles : {loadError}
          </p>
        )}
        {!options && !loadError && <p className="text-[11px] text-[var(--color-muted)] animate-pulse">Chargement des options du projet…</p>}

        {options && (
          <div className="grid grid-cols-2 gap-3">
            <UserPicker
              label={isGitHub ? "Relecteurs" : "Relecteurs (reviewers)"}
              choices={reviewerChoices}
              value={reviewers}
              onChange={setReviewers}
            />
            <UserPicker
              label="Assignés"
              choices={options.users}
              value={assignees}
              onChange={setAssignees}
              self={options.users.find((u) => u.username === account.username)}
            />
            <TagPicker
              label="Labels"
              choices={options.labels.map((l) => ({ key: l.name, label: l.name, color: l.color }))}
              value={labels}
              onChange={setLabels}
            />
            <label className="flex flex-col gap-1 min-w-0">
              <span className={labelClass}>Jalon</span>
              <select
                className={inputClass}
                value={milestone?.id ?? ""}
                onChange={(e) => setMilestone(options.milestones.find((m) => String(m.id) === e.target.value) ?? null)}
              >
                <option value="">Aucun</option>
                {options.milestones.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-1">
          <Check checked={draft} onChange={setDraft}>
            {isGitHub ? "Créer en brouillon (draft)" : "Marquer comme brouillon (Draft:)"}
          </Check>
          {!isGitHub && (
            <>
              <Check checked={removeSource} onChange={setRemoveSource}>Supprimer la branche source après le merge</Check>
              <Check checked={squash} onChange={setSquash}>Squasher les commits au merge</Check>
            </>
          )}
          {target.localBranch && (
            <Check checked={pushFirst} onChange={setPushFirst}>
              Pousser {target.localBranch} sur {remoteName} avant
              {target.needsPush && <span className="text-amber-300"> (commits non publiés)</span>}
            </Check>
          )}
          <Check checked={openAfter} onChange={setOpenAfter}>Ouvrir dans le navigateur après la création</Check>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} disabled={creating}>Annuler</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canCreate}>
            {creating ? "Création…" : `Créer la ${noun}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--color-text)] cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function UserPicker({ label, choices, value, onChange, self }: {
  label: string;
  choices: ForgeUser[];
  value: ForgeUser[];
  onChange: (users: ForgeUser[]) => void;
  /** Utilisateur du compte, proposé en raccourci « M'assigner ». */
  self?: ForgeUser;
}) {
  const byName = new Map(choices.map((u) => [u.username, u]));
  return (
    <TagPicker
      label={label}
      choices={choices.map((u) => ({ key: u.username, label: u.name !== u.username ? `${u.name} (@${u.username})` : `@${u.username}` }))}
      value={value.map((u) => u.username)}
      onChange={(names) => onChange(names.map((n) => byName.get(n)!).filter(Boolean))}
      action={self && !value.some((u) => u.username === self.username)
        ? { label: "Moi", run: () => onChange([...value, self]) }
        : undefined}
    />
  );
}

/** Sélection multiple avec recherche : puces des valeurs choisies + suggestions filtrées. */
function TagPicker({ label, choices, value, onChange, action }: {
  label: string;
  choices: { key: string; label: string; color?: string }[];
  value: string[];
  onChange: (keys: string[]) => void;
  action?: { label: string; run: () => void };
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const q = query.trim().toLowerCase();
  const suggestions = choices.filter((c) => !value.includes(c.key) && c.label.toLowerCase().includes(q)).slice(0, 8);
  const colorOf = (key: string) => choices.find((c) => c.key === key)?.color;

  return (
    <div className="flex flex-col gap-1 min-w-0 relative">
      <div className="flex items-center">
        <span className={labelClass}>{label}</span>
        {action && (
          <button className="ml-auto text-[10px] text-[var(--color-accent)] hover:underline" onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((key) => (
            <span key={key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-overlay/10 text-[11px] text-[var(--color-text)]">
              {colorOf(key) && <span className="w-2 h-2 rounded-full" style={{ background: colorOf(key) }} />}
              {key}
              <button className="opacity-60 hover:opacity-100" aria-label={`Retirer ${key}`} onClick={() => onChange(value.filter((v) => v !== key))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={inputClass}
        placeholder={choices.length ? "Rechercher…" : "Aucun choix disponible"}
        disabled={!choices.length}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions[0]) {
            onChange([...value, suggestions[0].key]);
            setQuery("");
          }
        }}
      />
      {focused && suggestions.length > 0 && (
        <ul className="absolute z-10 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-[var(--color-bg-elevated)] border border-overlay/10 rounded shadow-xl">
          {suggestions.map((c) => (
            <li key={c.key}>
              <button
                className="w-full text-left px-2 py-1 text-xs text-[var(--color-text)] hover:bg-overlay/10 flex items-center gap-2"
                // mousedown : avant que le champ perde le focus et ferme la liste.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange([...value, c.key]);
                  setQuery("");
                }}
              >
                {c.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />}
                <span className="truncate">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
