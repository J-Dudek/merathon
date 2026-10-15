/**
 * Paliers festifs : chaque commit, branche, PR / MR ou fusion est compté, et certains totaux déclenchent une animation.
 * Logique pure (compteurs, tirage au sort) ; l'affichage est dans components/Celebration.tsx.
 */

export type MilestoneKind = "commit" | "branch" | "pr" | "merge";

export type Effect = "confetti" | "fireworks" | "emoji" | "balloons" | "rocket" | "trophy";
export const EFFECTS: Effect[] = ["confetti", "fireworks", "emoji", "balloons", "rocket", "trophy"];

export interface MilestoneState {
  counts: Record<MilestoneKind, number>;
  /** Dernière animation jouée, pour ne pas enchaîner deux fois la même. */
  lastEffect: Effect | null;
  /** Récompenses obtenues, dans l'ordre (rubrique « Mon activité » des préférences). */
  rewards: Reward[];
  /** Dernière visite de « Mon activité » (ms) : les récompenses plus récentes sont marquées « nouveau ». */
  seenAt: number;
}

export interface Reward {
  kind: MilestoneKind;
  count: number;
  /** Date d'obtention (ms), null si elle est inconnue (récompense reconstituée d'après les compteurs). */
  at: number | null;
  surprise: boolean;
}

/** Au-delà, les plus anciennes surprises sont oubliées (les paliers, eux, restent). */
const MAX_SURPRISES = 100;

export interface Celebration {
  kind: MilestoneKind;
  count: number;
  effect: Effect;
  emoji: string;
  title: string;
  /** Pourquoi cette animation : l'action et le total atteint. */
  reason: string;
  /** Prochain palier du même type, pour donner envie. */
  next: string;
  nextCount: number;
  /** Ampleur du spectacle : 0 palier ordinaire, 1 gros palier, 2 très gros palier (voir `milestoneTier`). */
  tier: Tier;
  /** Petite surprise hors palier : animation plus discrète. */
  surprise: boolean;
}

/** Hasard purement décoratif (animations, messages) : aucune exigence de sécurité. */
export const random: () => number = Math.random;

export const emptyMilestones = (): MilestoneState => ({
  counts: { commit: 0, branch: 0, pr: 0, merge: 0 }, lastEffect: null, rewards: [], seenAt: 0,
});

export const MILESTONE_KINDS: MilestoneKind[] = ["commit", "branch", "pr", "merge"];

/** Paliers explicites, puis tous les `every` au-delà du dernier. */
const THRESHOLDS: Record<MilestoneKind, { list: number[]; every: number }> = {
  commit: { list: [10, 25, 50, 100, 200, 300, 500, 750, 1000], every: 500 },
  branch: { list: [1, 5, 10, 25, 50, 100], every: 50 },
  pr: { list: [1, 5, 10, 25, 50, 100], every: 50 },
  merge: { list: [5, 10, 25, 50, 100], every: 50 },
};

export type Tier = 0 | 1 | 2;

/** À partir de quels totaux le spectacle grandit : [gros palier, très gros palier]. */
const TIERS: Record<MilestoneKind, [number, number]> = {
  commit: [100, 1000],
  branch: [25, 100],
  pr: [25, 100],
  merge: [25, 100],
};

export function milestoneTier(kind: MilestoneKind, count: number): Tier {
  const [big, huge] = TIERS[kind];
  if (count >= huge) return 2;
  return count >= big ? 1 : 0;
}

/** Probabilité d'une surprise sur une action qui ne tombe pas sur un palier. */
export const SURPRISE_CHANCE = 0.01;

export function isMilestone(kind: MilestoneKind, count: number): boolean {
  const { list, every } = THRESHOLDS[kind];
  const last = list[list.length - 1];
  return list.includes(count) || (count > last && (count - last) % every === 0);
}

const EMOJIS: Record<MilestoneKind, string[]> = {
  commit: ["🎉", "✨", "💾", "🧱", "🔥"],
  branch: ["🌿", "🌱", "🌳", "🍃", "🌴"],
  pr: ["🚀", "📬", "🎁", "📦", "🛸"],
  merge: ["🤝", "🧩", "🔀", "🪢", "🎯"],
};

/** Emojis qui pleuvent pour ce type d'action. */
export const kindEmojis = (kind: MilestoneKind) => EMOJIS[kind];

const TITLES: Record<MilestoneKind, string[]> = {
  commit: [
    "{n} commits, ça se fête !",
    "{n} commits au compteur !",
    "Et de {n} commits !",
    "{n} commits : l'historique vous dit merci",
    "{n} commits, la machine est lancée",
  ],
  branch: [
    "{n} branches plantées !",
    "{n} branches : un vrai jardinier",
    "Et de {n} branches !",
    "{n} branches, la forêt grandit",
  ],
  pr: [
    "{n} pull requests envoyées !",
    "{n} PR / MR : les relecteurs n'ont qu'à bien se tenir",
    "Et de {n} demandes de fusion !",
    "{n} PR / MR, quelle productivité",
  ],
  merge: [
    "{n} fusions réussies !",
    "{n} merges : tout s'emboîte",
    "Et de {n} fusions !",
  ],
};

const FIRSTS: Partial<Record<MilestoneKind, string>> = {
  branch: "Première branche créée !",
  pr: "Première PR / MR ouverte !",
};

/** Nom de l'action au pluriel, pour le prochain palier. */
const PLURALS: Record<MilestoneKind, string> = {
  commit: "commits",
  branch: "branches",
  pr: "PR / MR",
  merge: "fusions",
};

const FEMININE: Record<MilestoneKind, boolean> = { commit: false, branch: true, pr: true, merge: true };

/** « 1er », « 1re », « 10ᵉ »… */
function ordinal(kind: MilestoneKind, n: number): string {
  if (n !== 1) return `${n}ᵉ`;
  return FEMININE[kind] ? "1re" : "1er";
}

/** Ce qui vient d'être fait, avant l'ordinal puis après : « de faire votre » 10ᵉ « commit ». */
const REASONS: Record<MilestoneKind, [string, string]> = {
  commit: ["de faire votre", "commit"],
  branch: ["de créer votre", "branche"],
  pr: ["d'ouvrir votre", "PR / MR"],
  merge: ["de réussir votre", "fusion"],
};

/** Phrase qui explique l'animation : « Vous venez de faire votre 10ᵉ commit avec Merathon. » */
export function milestoneReason(kind: MilestoneKind, count: number): string {
  const [verb, noun] = REASONS[kind];
  return `Vous venez ${verb} ${ordinal(kind, count)} ${noun} avec Merathon.`;
}

/** Libellé d'une récompense : « 10ᵉ commit », « 1re branche », « Surprise au 4ᵉ commit ». */
export function rewardLabel(r: Pick<Reward, "kind" | "count" | "surprise">): string {
  const label = `${ordinal(r.kind, r.count)} ${REASONS[r.kind][1]}`;
  return r.surprise ? `Surprise au ${label}` : label;
}

/** Paliers atteints avec `count` actions, du plus petit au plus grand. */
export function milestonesUpTo(kind: MilestoneKind, count: number): number[] {
  const reached: number[] = [];
  for (let n = nextMilestone(kind, 0); n <= count; n = nextMilestone(kind, n)) reached.push(n);
  return reached;
}

/** Palier suivant `count` pour ce type d'action. */
export function nextMilestone(kind: MilestoneKind, count: number): number {
  const { list, every } = THRESHOLDS[kind];
  const last = list[list.length - 1];
  return list.find((n) => n > count) ?? last + (Math.floor((count - last) / every) + 1) * every;
}

const SURPRISES = [
  "Commit porte-bonheur 🍀",
  "Celui-là, il sent bon",
  "Un commit sauvage apparaît !",
  "Joli message de commit (on suppose)",
  "Pile dans le mille",
];

const pick = <T>(list: T[], rand: () => number): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/** Animation au hasard, différente de la précédente. */
export function pickEffect(last: Effect | null, rand: () => number): Effect {
  return pick(EFFECTS.filter((e) => e !== last), rand);
}

/** Compte une action ; renvoie le nouvel état et, s'il y a lieu, l'animation à jouer. */
export function recordEvent(
  state: MilestoneState,
  kind: MilestoneKind,
  rand: () => number = random,
  now: number = Date.now(),
): { state: MilestoneState; celebration: Celebration | null } {
  const count = state.counts[kind] + 1;
  const counts = { ...state.counts, [kind]: count };
  const milestone = isMilestone(kind, count);
  const surprise = !milestone && kind === "commit" && rand() < SURPRISE_CHANCE;
  if (!milestone && !surprise) return { state: { ...state, counts }, celebration: null };

  const effect = surprise ? pick(["confetti", "emoji"] as Effect[], rand) : pickEffect(state.lastEffect, rand);
  // Le premier palier a son propre titre (« 1 branches » sonnerait mal).
  const title = surprise
    ? pick(SURPRISES, rand)
    : (count === 1 && FIRSTS[kind]) || pick(TITLES[kind], rand).replace("{n}", String(count));
  const next = nextMilestone(kind, count);
  const celebration: Celebration = {
    kind,
    count,
    effect,
    emoji: pick(EMOJIS[kind], rand),
    title,
    reason: surprise
      ? `Aucun palier cette fois : chaque commit a 1 chance sur ${Math.round(1 / SURPRISE_CHANCE)} de déclencher une surprise, et celui-ci (le ${ordinal(kind, count)}) a gagné.`
      : milestoneReason(kind, count),
    next: `Prochain palier : ${next} ${PLURALS[kind]}`,
    nextCount: next,
    tier: surprise ? 0 : milestoneTier(kind, count),
    surprise,
  };
  const reward: Reward = { kind, count, at: now, surprise };
  return { state: { ...state, counts, lastEffect: effect, rewards: trimSurprises([...state.rewards, reward]) }, celebration };
}

function trimSurprises(rewards: Reward[]): Reward[] {
  let extra = rewards.filter((r) => r.surprise).length - MAX_SURPRISES;
  return extra > 0 ? rewards.filter((r) => !(r.surprise && extra-- > 0)) : rewards;
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

function sanitizeReward(raw: unknown): Reward | null {
  const r = (raw ?? {}) as Partial<Record<keyof Reward, unknown>>;
  if (!MILESTONE_KINDS.includes(r.kind as MilestoneKind) || !isCount(r.count) || r.count === 0) return null;
  return { kind: r.kind as MilestoneKind, count: r.count, at: isCount(r.at) ? r.at : null, surprise: r.surprise === true };
}

/**
 * État relu depuis le stockage, valeurs invalides remises à zéro.
 * Un palier atteint d'après les compteurs mais absent de la liste (données d'avant les récompenses) est ajouté, sans date.
 */
export function sanitizeMilestones(raw: unknown): MilestoneState {
  const r = (raw ?? {}) as { counts?: Partial<Record<MilestoneKind, unknown>>; lastEffect?: unknown; rewards?: unknown; seenAt?: unknown };
  const base = emptyMilestones();
  for (const kind of MILESTONE_KINDS) {
    const n = r.counts?.[kind];
    if (isCount(n)) base.counts[kind] = n;
  }
  base.lastEffect = EFFECTS.includes(r.lastEffect as Effect) ? (r.lastEffect as Effect) : null;
  base.seenAt = isCount(r.seenAt) ? r.seenAt : 0;
  const rewards = (Array.isArray(r.rewards) ? r.rewards : []).map(sanitizeReward).filter((x): x is Reward => x !== null);
  const missing = MILESTONE_KINDS.flatMap((kind) =>
    milestonesUpTo(kind, base.counts[kind])
      .filter((count) => !rewards.some((w) => !w.surprise && w.kind === kind && w.count === count))
      .map((count): Reward => ({ kind, count, at: null, surprise: false })),
  );
  base.rewards = trimSurprises([...missing, ...rewards]);
  return base;
}

/** Type d'action festif correspondant à un appel au backend réussi, ou null. */
export function milestoneForCommand(cmd: string, args: unknown): MilestoneKind | null {
  const a = (args ?? {}) as { amend?: unknown };
  switch (cmd) {
    case "create_commit":
      return a.amend ? null : "commit";
    case "create_branch":
      return "branch";
    case "merge_branch":
    case "fast_forward":
      return "merge";
    default:
      return null;
  }
}
