import { useEffect, useMemo, useRef, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { interactiveRebase, rebaseTodo, type RebaseAction, type RebaseMode } from "../ipc/commands";
import { errorMessage, reportInteractive } from "../lib/actions";
import { Button, Modal, inputClass } from "./Modal";
import type { TodoCommit } from "../types/git";

interface Row {
  commit: TodoCommit;
  action: RebaseAction;
  message: string;
}

const ACTIONS: { value: RebaseAction; label: string; hint: string; merge: boolean }[] = [
  { value: "pick", label: "Garder", hint: "Conserver le commit tel quel", merge: true },
  { value: "reword", label: "Renommer", hint: "Conserver le commit en changeant son message", merge: true },
  { value: "edit", label: "Modifier", hint: "S'arrêter après ce commit pour le modifier (amend) ou ajouter des commits", merge: true },
  { value: "squash", label: "Fusionner", hint: "Fusionner avec le commit précédent (messages combinés)", merge: false },
  { value: "fixup", label: "Fixup", hint: "Fusionner avec le commit précédent en gardant son message", merge: false },
  { value: "drop", label: "Supprimer", hint: "Retirer le commit de l'historique", merge: true },
];

/** Vérifie le plan avant de l'envoyer ; renvoie un message d'erreur ou null. */
export function validatePlan(rows: Pick<Row, "action" | "message">[]): string | null {
  const kept = rows.filter((r) => r.action !== "drop");
  if (kept.length === 0) return "Le plan supprime tous les commits : utilise plutôt un reset.";
  if (kept[0].action === "squash" || kept[0].action === "fixup")
    return "Le premier commit conservé ne peut pas être fusionné : il n'a pas de commit précédent.";
  if (rows.some((r) => r.action === "reword" && !r.message.trim())) return "Un commit à renommer n'a pas de message.";
  return null;
}

/** Déplace l'élément `from` à la position `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function rowsFor(todo: TodoCommit[], mode: RebaseMode): Row[] {
  return todo
    .filter((c) => mode === "preserve" || !c.is_merge)
    .map((commit) => ({ commit, action: "pick" as RebaseAction, message: commit.message }));
}

export function InteractiveRebaseDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const repoPath = useRepoStore((s) => s.repoPath);
  const info = useRepoStore((s) => s.info);
  const refresh = useRepoStore((s) => s.refresh);
  const [todo, setTodo] = useState<TodoCommit[] | null>(null);
  const [mode, setMode] = useState<RebaseMode>("linear");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repoPath) return;
    rebaseTodo(repoPath, base)
      .then((list) => {
        setTodo(list);
        setRows(rowsFor(list, "linear"));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [repoPath, base]);

  const merges = useMemo(() => todo?.filter((c) => c.is_merge).length ?? 0, [todo]);
  const canReorder = mode === "linear";

  function switchMode(next: RebaseMode) {
    if (!todo || next === mode) return;
    setMode(next);
    setRows(rowsFor(todo, next));
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  // Glisser-déposer à la souris : la liste se réordonne pendant le déplacement.
  function onHandleDown(e: React.PointerEvent, i: number) {
    if (!canReorder) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDragging(i);
  }

  function onHandleMove(e: React.PointerEvent) {
    if (dragging === null || !listRef.current) return;
    const items = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-row]"));
    let target = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (target === -1) target = items.length - 1;
    else if (target > dragging) target -= 1;
    if (target !== dragging) {
      setRows((prev) => moveItem(prev, dragging, target));
      setDragging(target);
    }
  }

  function onHandleUp(e: React.PointerEvent) {
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    setDragging(null);
  }

  const planError = rows.length ? validatePlan(rows) : null;
  const original = useMemo(() => (todo ? rowsFor(todo, mode).map((r) => r.commit.hash) : []), [todo, mode]);
  // Plan identique à l'historique : rien à faire (sauf aplatir des merges en mode linéaire).
  const noop = rows.every((r, i) => r.action === "pick" && r.commit.hash === original[i]) && (mode === "preserve" || merges === 0);

  async function start() {
    if (!repoPath || planError) return;
    setRunning(true);
    setError(null);
    try {
      const outcome = await interactiveRebase(
        repoPath,
        base,
        rows.map((r) => ({
          hash: r.commit.hash,
          action: r.action,
          message: r.action === "reword" || r.action === "squash" ? r.message : null,
        })),
        mode,
      );
      reportInteractive(outcome);
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal title={`Rebase interactif de ${info?.head_branch ?? "HEAD"} sur ${base.slice(0, 7)}`} onClose={() => !running && onClose()} width="w-[760px]">
      <div className="p-4 flex flex-col gap-3">
        {merges > 0 && (
          <div className="flex flex-col gap-1.5 p-2 rounded border border-overlay/10 bg-shade/20">
            <p className="text-[11px] text-[var(--color-text)]">
              L'historique contient {merges} commit{merges > 1 ? "s" : ""} de merge.
            </p>
            <div className="grid grid-cols-2 gap-1">
              <ModeBtn active={mode === "linear"} onClick={() => switchMode("linear")} title="Aplatir l'historique">
                Les merges disparaissent, leurs commits sont rejoués à la suite. Ordre libre.
              </ModeBtn>
              <ModeBtn active={mode === "preserve"} onClick={() => switchMode("preserve")} title="Préserver les merges">
                La forme de l'historique est conservée. Ordre fixe ; les résolutions de conflits des merges sont gardées.
              </ModeBtn>
            </div>
          </div>
        )}

        <p className="text-[11px] text-[var(--color-muted)]">
          Du plus ancien (en haut) au plus récent.{" "}
          {canReorder ? "Réordonne en glissant la poignée ⠿ ou avec les flèches. " : ""}
          Le rebase s'arrête sur un conflit (à résoudre) ou sur un commit « Modifier » ; tu peux l'annuler à tout moment.
        </p>

        {!todo && !error && <p className="text-xs text-[var(--color-muted)] animate-pulse">Chargement…</p>}
        {todo && rows.length === 0 && <p className="text-xs text-[var(--color-muted)] italic">Aucun commit à réécrire.</p>}

        {rows.length > 0 && (
          <div ref={listRef} className="flex flex-col border border-overlay/10 rounded divide-y divide-overlay/5 max-h-[50vh] overflow-y-auto">
            {rows.map((row, i) => {
              const editable = row.action === "reword" || row.action === "squash";
              const isMerge = row.commit.is_merge;
              return (
                <div
                  key={row.commit.hash}
                  data-row
                  className={`flex flex-col gap-1 px-2 py-1.5 ${row.action === "drop" ? "opacity-50" : ""} ${
                    dragging === i ? "bg-[var(--color-accent)]/15" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {canReorder && (
                      <>
                        <span
                          role="button"
                          aria-label="Déplacer"
                          title="Glisser pour déplacer"
                          className="cursor-grab active:cursor-grabbing select-none text-[var(--color-muted)] hover:text-[var(--color-text)] px-0.5 touch-none"
                          onPointerDown={(e) => onHandleDown(e, i)}
                          onPointerMove={onHandleMove}
                          onPointerUp={onHandleUp}
                        >
                          ⠿
                        </span>
                        <div className="flex flex-col">
                          <button className="text-[9px] leading-3 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30" disabled={i === 0} onClick={() => setRows((p) => moveItem(p, i, i - 1))} aria-label="Monter">▲</button>
                          <button className="text-[9px] leading-3 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => setRows((p) => moveItem(p, i, i + 1))} aria-label="Descendre">▼</button>
                        </div>
                      </>
                    )}
                    <select
                      className="w-28 shrink-0 bg-shade/30 border border-overlay/10 rounded px-1.5 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
                      value={row.action}
                      title={ACTIONS.find((a) => a.value === row.action)?.hint}
                      onChange={(e) => {
                        const action = e.target.value as RebaseAction;
                        // Squash : vide = messages combinés ; reword : on part du message actuel.
                        update(i, { action, message: action === "squash" ? "" : row.commit.message });
                      }}
                    >
                      {ACTIONS.filter((a) => !isMerge || a.merge).map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                    <span className="font-mono text-[11px] text-[var(--color-accent)]">{row.commit.short_hash}</span>
                    {isMerge && (
                      <span className="text-[9px] px-1 rounded border border-sky-400/40 text-sky-300 shrink-0">merge</span>
                    )}
                    <span className={`text-xs truncate flex-1 ${row.action === "drop" ? "line-through" : "text-[var(--color-text)]"}`}>
                      {row.commit.summary}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted)] shrink-0">{row.commit.author}</span>
                  </div>
                  {editable && (
                    <textarea
                      rows={row.action === "squash" ? 3 : 2}
                      className={`${inputClass} resize-y ${canReorder ? "ml-[10rem]" : "ml-[7.5rem]"} w-auto!`}
                      placeholder={row.action === "squash" ? "Message du commit fusionné (vide : messages combinés)" : "Nouveau message"}
                      value={row.message}
                      onChange={(e) => update(i, { message: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(error || planError) && <p className="text-xs text-red-400 break-words">{error ?? planError}</p>}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={running}>Annuler</Button>
          <Button variant="primary" onClick={start} disabled={running || !rows.length || !!planError || noop}>
            {running ? "Rebase…" : "Lancer le rebase"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModeBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2 rounded border transition-colors ${
        active ? "border-[var(--color-accent)]/60 bg-overlay/5" : "border-overlay/10 hover:bg-overlay/5"
      }`}
    >
      <span className={`block text-xs font-semibold ${active ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>{title}</span>
      <span className="block text-[10px] text-[var(--color-muted)]">{children}</span>
    </button>
  );
}
