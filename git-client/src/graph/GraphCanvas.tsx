import { useEffect, useMemo, useRef, useState } from "react";
import { branchNamesByRow, type CommitNode, type GraphEdge, type GraphLayout } from "./layout";
import { authorInitials } from "../lib/initials";
import { themeColor, useThemeStore } from "../lib/theme";

export const LANE_WIDTH = 24;
/** Assez grand pour contenir les initiales de l'auteur. */
const NODE_RADIUS = 9;
const MERGE_RADIUS = 4;
export const H_PADDING = 10;

interface Props {
  layout: GraphLayout;
  selectedHash: string | null;
  headHash: string | null;
  onSelectRow: (row: number) => void;
  width: number;
  /** Hauteur d'une ligne (densité choisie dans les réglages d'affichage). */
  rowHeight: number;
  /** Position de défilement et hauteur visibles : seul ce qui est à l'écran est dessiné. */
  scrollTop: number;
  viewportHeight: number;
}

export function GraphCanvas({ layout, selectedHash, headHash, onSelectRow, width, rowHeight, scrollTop, viewportHeight }: Props) {
  const rowY = (row: number) => row * rowHeight + rowHeight / 2;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const height = Math.max(viewportHeight, 1);
  // Auteur du point survolé, affiché dans une infobulle près du curseur.
  const [hover, setHover] = useState<{ author: string | null; branch: string | null; x: number; y: number } | null>(null);
  // Branche de chaque commit, pour nommer ce qui est survolé dans l'arbre.
  const branchNames = useMemo(() => branchNamesByRow(layout.nodes.map((n) => n.commit)), [layout]);
  const theme = useThemeStore((s) => s.theme);

  // Au défilement, le point sous le curseur change : l'infobulle reviendra au prochain mouvement.
  useEffect(() => setHover(null), [scrollTop]);

  // Échap masque l'infobulle jusqu'au prochain mouvement de la souris (WCAG 1.4.13).
  const hoverShown = hover !== null;
  useEffect(() => {
    if (!hoverShown) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHover(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverShown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, -scrollTop * dpr);
    ctx.clearRect(0, scrollTop, width, height);

    const top = scrollTop - rowHeight;
    const bottom = scrollTop + height + rowHeight;
    for (const edge of layout.edges) drawEdge(ctx, edge, top, bottom, rowHeight);

    // Point de HEAD évidé : couleur du fond, relue à chaque changement de thème.
    const background = themeColor("--color-bg-primary", "#1a1b26");
    const firstRow = Math.max(0, Math.floor(top / rowHeight));
    const lastRow = Math.min(layout.nodes.length - 1, Math.ceil(bottom / rowHeight));
    for (let row = firstRow; row <= lastRow; row++) {
      const node = layout.nodes[row];
      drawNode(ctx, node, { selected: node.commit.hash === selectedHash, head: node.commit.hash === headHash }, rowHeight, background);
    }
  }, [layout, selectedHash, headHash, width, height, scrollTop, rowHeight, theme]);

  /** Commit dont le point est sous le curseur. */
  function nodeAt(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top + scrollTop;
    const node = layout.nodes[Math.floor(py / rowHeight)];
    if (!node) return null;
    const radius = node.commit.parents.length > 1 ? MERGE_RADIUS : NODE_RADIUS;
    return Math.hypot(px - laneX(node.lane), py - rowY(node.row)) <= radius + 2 ? node : null;
  }

  /** Branche dont la ligne passe sous le curseur (arête la plus proche, à quelques pixels près). */
  function edgeBranchAt(e: React.MouseEvent<HTMLCanvasElement>): string | null {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top + scrollTop;
    let best: { name: string; d: number } | null = null;
    for (const edge of layout.edges) {
      if (py < rowY(edge.fromRow) - EDGE_HIT || py > rowY(edge.toRow) + EDGE_HIT) continue;
      // Une branche fusionnée prend le nom de ce qu'elle rejoint ; sinon celui de son commit le plus récent.
      const name = branchNames[edge.curve === "start" ? edge.toRow : edge.fromRow] ?? branchNames[edge.fromRow] ?? branchNames[edge.toRow];
      if (!name) continue;
      const d = distanceToPolyline(edgePoints(edge, rowHeight), px, py);
      if (d <= EDGE_HIT && (!best || d < best.d)) best = { name, d };
    }
    return best?.name ?? null;
  }

  function handleMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const node = nodeAt(e);
    if (node) {
      setHover({ author: node.commit.author, branch: branchNames[node.row], x: e.clientX, y: e.clientY });
      return;
    }
    const branch = edgeBranchAt(e);
    setHover(branch ? { author: null, branch, x: e.clientX, y: e.clientY } : null);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const row = Math.floor((e.clientY - rect.top + scrollTop) / rowHeight);
    if (row >= 0 && row < layout.nodes.length) {
      onSelectRow(row);
    }
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ width, height, position: "sticky", top: 0, left: 0, display: "block" }}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        className="cursor-pointer"
        aria-hidden
      />
      {hover && (
        <div
          aria-hidden
          className="fixed z-50 pointer-events-none px-1.5 py-0.5 rounded text-[11px] bg-black/85 text-white border border-overlay/10 whitespace-nowrap"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {hover.branch && <span className="font-mono font-semibold">{hover.branch}</span>}
          {hover.branch && hover.author && <span className="opacity-60"> · </span>}
          {hover.author}
        </div>
      )}
    </>
  );
}

/** Distance (px) à partir de laquelle une ligne du graphe est considérée sous le curseur. */
const EDGE_HIT = 5;

const laneX = (lane: number) => H_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
const centerY = (row: number, rowHeight: number) => row * rowHeight + rowHeight / 2;

function drawEdge(ctx: CanvasRenderingContext2D, edge: GraphEdge, top: number, bottom: number, rowHeight: number) {
  const y1 = centerY(edge.fromRow, rowHeight);
  const y2 = centerY(edge.toRow, rowHeight);
  if (y2 < top || y1 > bottom) return;
  const x1 = laneX(edge.fromLane);
  const x2 = laneX(edge.toLane);

  ctx.beginPath();
  ctx.strokeStyle = edge.color;
  ctx.lineWidth = 1.5;
  ctx.moveTo(x1, y1);
  if (x1 === x2) {
    ctx.lineTo(x2, y2);
  } else if (edge.curve === "start") {
    // Quitte l'enfant en courbe vers la colonne du parent, puis descend.
    const yCurve = Math.min(y1 + rowHeight, y2);
    ctx.bezierCurveTo(x1, (y1 + yCurve) / 2, x2, (y1 + yCurve) / 2, x2, yCurve);
    ctx.lineTo(x2, y2);
  } else {
    // Descend dans la colonne de l'enfant, puis rejoint le parent en courbe.
    const yCurve = Math.max(y2 - rowHeight, y1);
    ctx.lineTo(x1, yCurve);
    ctx.bezierCurveTo(x1, (yCurve + y2) / 2, x2, (yCurve + y2) / 2, x2, y2);
  }
  ctx.stroke();
}

/** Remplissage d'un point : blanc s'il est sélectionné, couleur du fond pour HEAD, couleur de la branche sinon. */
function nodeFill(color: string, { selected, head }: { selected: boolean; head: boolean }, background: string): string {
  if (selected) return "#ffffff";
  if (head) return background;
  return color;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: CommitNode,
  state: { selected: boolean; head: boolean },
  rowHeight: number,
  background: string,
) {
  const nx = laneX(node.lane);
  const ny = centerY(node.row, rowHeight);
  const highlighted = state.selected || state.head;
  // Les merges restent de petits points ; les autres commits portent les initiales de l'auteur.
  const isMerge = node.commit.parents.length > 1;
  const mergeRadius = highlighted ? MERGE_RADIUS + 1.5 : MERGE_RADIUS;

  ctx.beginPath();
  ctx.arc(nx, ny, isMerge ? mergeRadius : NODE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = nodeFill(node.color, state, background);
  ctx.fill();
  if (highlighted) {
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  if (isMerge) return;

  const initials = authorInitials(node.commit.author);
  ctx.fillStyle = highlighted ? node.color : "#ffffff";
  ctx.font = `600 ${initials.length > 1 ? 8 : 9}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, nx, ny + 0.5);
}

/** Points d'une arête, courbes échantillonnées : mêmes tracés que `drawEdge`. */
export function edgePoints(edge: GraphEdge, rowHeight: number): [number, number][] {
  const y1 = centerY(edge.fromRow, rowHeight);
  const y2 = centerY(edge.toRow, rowHeight);
  const x1 = laneX(edge.fromLane);
  const x2 = laneX(edge.toLane);
  if (x1 === x2) return [[x1, y1], [x2, y2]];
  const bezier = (ax: number, ay: number, bx: number, by: number, midY: number): [number, number][] =>
    Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const u = 1 - t;
      // Courbe de Bézier cubique (ax,ay) → (bx,by), points de contrôle (ax,midY) et (bx,midY).
      return [u ** 3 * ax + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * bx, u ** 3 * ay + 3 * u * u * t * midY + 3 * u * t * t * midY + t ** 3 * by];
    });
  if (edge.curve === "start") {
    const yCurve = Math.min(y1 + rowHeight, y2);
    return [...bezier(x1, y1, x2, yCurve, (y1 + yCurve) / 2), [x2, y2]];
  }
  const yCurve = Math.max(y2 - rowHeight, y1);
  return [[x1, y1], [x1, yCurve], ...bezier(x1, yCurve, x2, y2, (yCurve + y2) / 2)];
}

/** Plus courte distance entre le point (px, py) et une ligne brisée. */
export function distanceToPolyline(points: [number, number][], px: number, py: number): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
