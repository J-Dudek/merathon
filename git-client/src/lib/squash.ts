import type { RebaseMode, RebaseStep } from "../ipc/commands";
import type { TodoCommit } from "../types/git";
import { appendThreadTrailers, extractThreadTrailers, mergeThreadLinks } from "./threadTrailers";

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
  const final = squashMessage(commits, message);
  // Chaque squash remplace le message du commit cumulé : le dernier porte le message final.
  const squash = (c: TodoCommit): RebaseStep => ({
    hash: c.hash,
    action: "squash",
    message: c === last ? final : null,
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

/**
 * Message du commit squashé, null pour garder les messages concaténés.
 * Git ne lit les trailers que dans le dernier paragraphe : les fils de revue de tous les commits y sont regroupés,
 * sinon la concaténation (ou un nouveau message) les ferait perdre.
 */
function squashMessage(commits: TodoCommit[], message: string): string | null {
  const parts = commits.map((c) => extractThreadTrailers(c.message));
  const typed = extractThreadTrailers(message);
  const links = mergeThreadLinks(...parts.map((p) => p.links), typed.links);
  if (!Object.keys(links).length) return message.trim() || null;
  // Même concaténation que le backend pour un message vide.
  const text = typed.text || parts.map((p) => p.text).join("\n\n");
  return appendThreadTrailers(text, links);
}
