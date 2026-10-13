import type { RebaseMode, RebaseStep } from "../ipc/commands";
import type { TodoCommit } from "../types/git";

export interface SquashPlan {
  steps: RebaseStep[];
  mode: RebaseMode;
  /** Commits squashés, du plus ancien au plus récent. */
  commits: TodoCommit[];
}

/**
 * Plan de rebase interactif qui fusionne les commits sélectionnés dans le plus ancien d'entre eux.
 * Les commits à rejouer viennent de `rebaseTodo`, lancé depuis le parent du plus ancien commit sélectionné.
 * Un message vide garde les messages concaténés.
 * Renvoie un message d'erreur si la sélection ne peut pas être squashée.
 */
export function squashPlan(todo: TodoCommit[], selected: string[], message: string): SquashPlan | string {
  const wanted = new Set(selected);
  const commits = todo.filter((c) => wanted.has(c.hash));
  if (wanted.size < 2) return "Sélectionne au moins deux commits";
  if (commits.length !== wanted.size) return "Les commits sélectionnés doivent tous appartenir à la branche courante";
  if (commits.some((c) => c.is_merge)) return "Un commit de merge ne peut pas être squashé";

  const [target, ...rest] = commits;
  const last = rest[rest.length - 1];
  // Chaque squash remplace le message du commit cumulé : le dernier porte le message final.
  const squash = (c: TodoCommit): RebaseStep => ({
    hash: c.hash,
    action: "squash",
    message: c === last && message.trim() ? message.trim() : null,
  });
  const pick = (c: TodoCommit): RebaseStep => ({ hash: c.hash, action: "pick", message: null });

  if (todo.some((c) => c.is_merge)) {
    // Merges conservés : l'ordre ne bouge pas, les commits sélectionnés doivent donc se suivre.
    if (rest.some((c) => !wanted.has(c.parents[0]))) {
      return "L'historique contient des merges : les commits sélectionnés doivent se suivre";
    }
    return { mode: "preserve", commits, steps: todo.map((c) => (wanted.has(c.hash) && c !== target ? squash(c) : pick(c))) };
  }

  // Historique linéaire : les commits sélectionnés sont regroupés derrière le plus ancien.
  const steps: RebaseStep[] = [];
  for (const c of todo) {
    if (c === target) steps.push(pick(c), ...rest.map(squash));
    else if (!wanted.has(c.hash)) steps.push(pick(c));
  }
  return { mode: "linear", commits, steps };
}
