import { useEffect, useState } from "react";
import { useAccountsStore } from "../store/useAccountsStore";
import { errorMessage } from "../lib/actions";
import { fieldLabel } from "../lib/fieldLabel";
import { hasThreadReply, type ThreadAction, type ThreadLinks } from "../lib/threadTrailers";
import { Button, Modal, inputClass } from "./Modal";
import type { LinkedForge } from "./PullRequestList";
import type { ForgePR, ReviewThread } from "../types/forge";
import { tr, COLON } from "../i18n";

const EXCERPT = 140;

function excerpt(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;
}

/** Non résolus d'abord, puis obsolètes, puis résolus. */
function rank(t: ReviewThread): number {
  if (t.resolved === false) return 0;
  return t.resolved === null ? 1 : 2;
}

/**
 * Fils de revue de la PR que le commit traite : chacun reçoit après le push une réponse citant le commit,
 * et est résolu si demandé.
 */
export function ReviewThreadPicker({ forge, pr, value, onChange, onClose }: {
  forge: LinkedForge;
  pr: ForgePR;
  value: ThreadLinks;
  onChange: (links: ThreadLinks) => void;
  onClose: () => void;
}) {
  const client = useAccountsStore((s) => s.client);
  const [threads, setThreads] = useState<ReviewThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<ThreadLinks>(value);
  const ref = forge.account.provider === "github" ? `#${pr.number}` : `!${pr.number}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await (await client(forge.account)).getReviewThreads(forge.projectPath, pr.number);
        if (!cancelled) setThreads([...list].sort((a, b) => rank(a) - rank(b)));
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, forge, pr.number]);

  function setAction(id: string, action: ThreadAction | "") {
    setLinks((l) => {
      const next = { ...l };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  }

  /** Fils liés au brouillon mais absents de la PR (supprimés, ou brouillon d'une autre branche). */
  const unknown = threads ? Object.keys(links).filter((id) => !threads.some((t) => t.id === id)) : [];

  return (
    <Modal title={tr("Fils de revue traités · {ref}", { ref })} onClose={onClose} width="w-[640px]">
      <div className="p-4 flex flex-col gap-3 text-xs text-[var(--color-text)]">
        <p className="text-[11px] text-[var(--color-muted)]">
          {tr("Le commit note les fils choisis en fin de message. Après le push, chacun reçoit une réponse avec le lien du commit, puis est résolu si demandé.")}
        </p>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        {!threads && !error && <p className="text-[var(--color-muted)]">{tr("Chargement des fils…")}</p>}
        {threads?.length === 0 && <p className="text-[var(--color-muted)] italic">{tr("Aucun commentaire de ligne sur {ref}.", { ref })}</p>}
        {threads && threads.length > 0 && (
          <ul className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
            {threads.map((t) => {
              const first = t.comments[0];
              const where = t.line == null ? t.path : `${t.path}:${t.line}`;
              return (
                <li key={t.id} className="flex items-start gap-2 p-2 rounded bg-shade/20 border border-overlay/10">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[11px] truncate" title={where}>{where}</p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      {first?.author && <span className="font-semibold">{first.author}{COLON}</span>}
                      {excerpt(first?.body ?? "")}
                    </p>
                    <p className="text-[10px] text-[var(--color-muted)] opacity-80">
                      {t.resolved === true && tr("Résolu")}
                      {t.resolved === null && tr("Obsolète ou non résoluble")}
                      {t.comments.length > 1 && tr("{value}{length} commentaires", { value: t.resolved !== false ? " · " : "", length: t.comments.length })}
                      {hasThreadReply(t) && tr(" · déjà lié à un commit")}
                    </p>
                  </div>
                  <select
                    className={`${inputClass} w-auto! shrink-0`}
                    {...fieldLabel(tr("Suite à donner au fil {where}", { where }))}
                    value={links[t.id] ?? ""}
                    onChange={(e) => setAction(t.id, e.target.value as ThreadAction | "")}
                  >
                    <option value="">—</option>
                    <option value="address">{tr("Répondre")}</option>
                    {t.resolved === false && <option value="resolve">{tr("Répondre et résoudre")}</option>}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
        {unknown.length > 0 && (
          <p className="text-[11px] text-amber-300">
            {unknown.length > 1 ? tr("{length} fils liés au brouillon sont absents", { length: unknown.length }) : tr("Un fil lié au brouillon est absent")}{" "}{tr("de {ref} : ils restent dans le message mais seront ignorés au push.", { ref })}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{tr("Annuler")}</Button>
          <Button variant="primary" onClick={() => { onChange(links); onClose(); }}>{tr("Valider")}</Button>
        </div>
      </div>
    </Modal>
  );
}
