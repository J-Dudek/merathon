import type { CommitInfo } from "../types/git";

export interface CommitNode {
  commit: CommitInfo;
  lane: number;
  row: number;
  color: string;
}

export interface GraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  color: string;
  /**
   * Où se fait le changement de colonne quand fromLane !== toLane :
   * - "start" : juste sous l'enfant (une branche fusionnée part du commit de merge) ;
   * - "end"   : juste au-dessus du parent (une branche rejoint son point de départ).
   */
  curve: "start" | "end";
}

export interface GraphLayout {
  nodes: CommitNode[];
  edges: GraphEdge[];
  laneCount: number;
}

const LANE_COLORS = [
  "#7c6af7", "#36b37e", "#e94560", "#f59e0b",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

interface PendingEdge {
  fromRow: number;
  fromLane: number;
  parentHash: string;
  color: string;
  curve: GraphEdge["curve"];
}

/** Première colonne libre (une nouvelle colonne est ajoutée si besoin). */
function freeLane(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null);
  if (free !== -1) return free;
  lanes.push(null);
  return lanes.length - 1;
}

/**
 * Colonne d'un commit : celle réservée par un enfant, sinon la première libre.
 * Plusieurs enfants peuvent attendre ce commit : leurs autres colonnes le rejoignent ici et se libèrent.
 */
function takeLane(lanes: (string | null)[], hash: string): number {
  const reserved = lanes.indexOf(hash);
  const lane = reserved === -1 ? freeLane(lanes) : reserved;
  lanes.forEach((h, i) => {
    if (i !== lane && h === hash) lanes[i] = null;
  });
  return lane;
}

/** Colonne où un parent fusionné est attendu (réservée au besoin). */
function reserveLane(lanes: (string | null)[], hash: string): number {
  const existing = lanes.indexOf(hash);
  if (existing !== -1) return existing;
  const lane = freeLane(lanes);
  lanes[lane] = hash;
  return lane;
}

export function computeGraphLayout(commits: CommitInfo[]): GraphLayout {
  if (commits.length === 0) return { nodes: [], edges: [], laneCount: 0 };

  const hashToRow = new Map<string, number>();
  commits.forEach((c, i) => hashToRow.set(c.hash, i));

  // lanes[i] = hash du commit attendu dans la colonne i (le parent d'un commit déjà placé)
  const lanes: (string | null)[] = [];
  const nodes: CommitNode[] = [];
  const pending: PendingEdge[] = [];
  let maxLanes = 0;

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];

    const lane = takeLane(lanes, commit.hash);
    const color = laneColor(lane);
    nodes.push({ commit, lane, row, color });

    const [firstParent, ...mergeParents] = commit.parents;
    if (firstParent !== undefined && hashToRow.has(firstParent)) {
      // Le premier parent continue dans notre colonne
      lanes[lane] = firstParent;
      pending.push({ fromRow: row, fromLane: lane, parentHash: firstParent, color, curve: "end" });
    } else {
      lanes[lane] = null;
    }

    for (const parentHash of mergeParents.filter((p) => hashToRow.has(p))) {
      pending.push({ fromRow: row, fromLane: lane, parentHash, color: laneColor(reserveLane(lanes, parentHash)), curve: "start" });
    }

    maxLanes = Math.max(maxLanes, lanes.length);
  }

  const laneByHash = new Map(nodes.map((n) => [n.commit.hash, n.lane]));
  const edges: GraphEdge[] = pending.map((e) => ({
    fromRow: e.fromRow,
    fromLane: e.fromLane,
    toRow: hashToRow.get(e.parentHash)!,
    toLane: laneByHash.get(e.parentHash)!,
    color: e.color,
    curve: e.curve,
  }));

  return { nodes, edges, laneCount: Math.max(1, maxLanes) };
}

/** Nom de branche sans le préfixe de son remote (« origin/main » → « main »), pour reconnaître les branches principales. */
function bareName(name: string): string {
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

const MAIN_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk"]);

/**
 * Branche à laquelle appartient chaque commit (par ligne), `null` si aucune étiquette de branche ne l'atteint.
 * Chaque pointe de branche donne son nom aux commits qu'elle atteint en suivant les premiers parents, jusqu'à un commit
 * déjà nommé. Les branches principales passent d'abord, puis les locales avant les distantes, pour que `main` garde son
 * historique quand une branche en est partie.
 */
export function branchNamesByRow(commits: CommitInfo[]): (string | null)[] {
  const hashToRow = new Map<string, number>();
  commits.forEach((c, i) => hashToRow.set(c.hash, i));

  const tips: { row: number; name: string; rank: number }[] = [];
  commits.forEach((commit, row) => {
    for (const ref of commit.refs) {
      if (ref.kind === "tag") continue;
      const remote = ref.kind === "remote";
      tips.push({ row, name: ref.name, rank: (MAIN_BRANCHES.has(bareName(ref.name)) ? 0 : 2) + (remote ? 1 : 0) });
    }
  });
  tips.sort((a, b) => a.rank - b.rank || a.row - b.row);

  const names: (string | null)[] = commits.map(() => null);
  for (const tip of tips) {
    let row: number | undefined = tip.row;
    while (row !== undefined && names[row] === null) {
      names[row] = tip.name;
      const parent: string | undefined = commits[row].parents[0];
      row = parent === undefined ? undefined : hashToRow.get(parent);
    }
  }
  return names;
}
