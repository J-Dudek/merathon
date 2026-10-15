import { useEffect, useRef, useState } from "react";
import { useCelebrationStore } from "../store/useCelebrationStore";
import { kindEmojis, random, type Celebration as CelebrationData, type Effect, type Tier } from "../lib/milestones";

/** Couleurs des confettis et feux d'artifice : décoratives, identiques dans les deux thèmes. */
const PALETTE = ["#e94560", "#f6c445", "#4ade80", "#38bdf8", "#a78bfa", "#fb923c", "#f472b6"];
const FLAME = ["#f6c445", "#fb923c", "#e94560"];
/** Polices emoji en couleur : sans elles, WebKitGTK peut dessiner les emojis en noir et blanc ou en carrés. */
const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

/** Durée totale selon l'ampleur, en ms ; tout s'estompe pendant les FADE dernières ms. */
const DURATIONS: Record<Tier, number> = { 0: 4500, 1: 5500, 2: 7500 };
const SURPRISE_DURATION = 3000;
const FADE = 600;
/** Les vitesses sont exprimées par image à 60 Hz ; `dt` ramène au temps réellement écoulé. */
const FRAME_MS = 1000 / 60;
const ROCKET_MS = 1800;

const durationOf = (c: CelebrationData) => (c.surprise ? SURPRISE_DURATION : DURATIONS[c.tier]);

interface Particle {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number;
  size: number; color: string;
  shape: "rect" | "circle" | "spark" | "text";
  text?: string;
  /** Âge et durée de vie, en images à 60 Hz ; un âge négatif retarde l'apparition. */
  age: number; life: number;
  gravity: number; drag: number;
  /** Vitesse de chute maximale (résistance de l'air des confettis). */
  maxFall?: number;
  /** Retournement du confetti, qui papillonne en tombant. */
  flip?: number; flipSpeed?: number;
  /** Balancement latéral (ballons, confettis). */
  sway?: number;
  /** Scintillement des étincelles en fin de vie. */
  twinkle?: number;
}

const rnd = (min: number, max: number) => min + random() * (max - min);
const any = <T,>(list: T[]) => list[Math.floor(random() * list.length)];

const rectOrCircle = (): Particle["shape"] => (random() < 0.75 ? "rect" : "circle");

function confetti(w: number, h: number, count: number, origin?: { x: number; y: number }): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    // Deux canons en bas à gauche et à droite, tirés vers le centre ; ou une explosion autour de `origin`.
    const tilt = rnd(0.15, 0.9) * (left ? 1 : -1);
    const angle = origin ? rnd(0, Math.PI * 2) : -Math.PI / 2 + tilt;
    // Vitesse pour monter de 60 à 95 % de la hauteur de la fenêtre (la traînée en retire environ un quart).
    const speed = origin ? rnd(4, 11) : Math.sqrt(2 * 0.3 * h * rnd(0.6, 0.95)) * 1.25;
    return {
      x: origin?.x ?? (left ? 0 : w), y: origin?.y ?? h,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      rot: rnd(0, Math.PI), vr: rnd(-0.15, 0.15),
      size: rnd(7, 12), color: any(PALETTE), shape: rectOrCircle(),
      age: -rnd(0, 10), life: rnd(230, 300), gravity: 0.3, drag: 0.98, maxFall: rnd(1.4, 2.6),
      flip: rnd(0, Math.PI), flipSpeed: rnd(0.08, 0.2), sway: rnd(0, Math.PI * 2),
    };
  });
}

function firework(x: number, y: number, delay: number, power = 1): Particle[] {
  const color = any(PALETTE);
  const count = 80;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + rnd(-0.04, 0.04);
    const speed = rnd(2.5, 6.5) * power;
    return {
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, rot: 0, vr: 0,
      size: rnd(1.6, 2.8), color: random() < 0.8 ? color : any(PALETTE), shape: "spark",
      age: -delay, life: rnd(75, 105), gravity: 0.05, drag: 0.965, twinkle: rnd(0, Math.PI * 2),
    };
  });
}

function rain(w: number, emojis: string[], count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: rnd(0, w), y: rnd(-60, -20), vx: rnd(-0.6, 0.6), vy: rnd(1.5, 3), rot: rnd(-0.4, 0.4), vr: rnd(-0.04, 0.04),
    size: rnd(22, 38), color: "", shape: "text", text: any(emojis),
    age: -rnd(0, 80), life: 400, gravity: 0.03, drag: 0.995, maxFall: rnd(3, 4.5), sway: rnd(0, Math.PI * 2),
  }));
}

function balloons(w: number, h: number): Particle[] {
  return Array.from({ length: 22 }, () => ({
    // Départs étagés sous le bord : les ballons arrivent en continu, pas en une seule vague.
    x: rnd(0, w), y: h + rnd(20, 320), vx: 0, vy: rnd(-3.6, -2.6), rot: 0, vr: 0,
    size: rnd(34, 54), color: "", shape: "text", text: random() < 0.85 ? "🎈" : any(["🎉", "⭐"]),
    age: -rnd(0, 30), life: 400, gravity: -0.005, drag: 1, sway: rnd(0, Math.PI * 2),
  }));
}

/** Particules lancées au démarrage d'un effet ; la fusée est animée à part (voir `rocketStep`). */
function launch(effect: Effect, w: number, h: number, emojis: string[], small: boolean): Particle[] {
  switch (effect) {
    case "confetti":
      return confetti(w, h, small ? 70 : 180);
    case "fireworks":
      return Array.from({ length: small ? 2 : 6 }, (_, i) => firework(rnd(w * 0.15, w * 0.85), rnd(h * 0.12, h * 0.5), i * 20)).flat();
    case "emoji":
      return rain(w, emojis, small ? 25 : 60);
    case "balloons":
      return balloons(w, h);
    case "trophy":
      return confetti(w, h, 120, { x: w / 2, y: h * 0.42 }).map((p) => ({ ...p, age: p.age - 18 }));
    case "rocket":
      return [];
  }
}

/** Programme du spectacle : un effet pour un palier ordinaire, deux enchaînés pour un gros, le grand final pour un très gros. */
function schedule(effect: Effect, tier: Tier): { at: number; effect: Effect }[] {
  if (tier === 2) return [{ at: 0, effect: "rocket" }, { at: 2000, effect: "fireworks" }, { at: 3300, effect: "confetti" }];
  if (tier === 1) return [{ at: 0, effect }, { at: 1500, effect: effect === "confetti" ? "fireworks" : "confetti" }];
  return [{ at: 0, effect }];
}

/** Avance une particule de `dt` images et la dessine, avec l'opacité générale `alpha`. */
function step(ctx: CanvasRenderingContext2D, p: Particle, dt: number, alpha: number) {
  p.age += dt;
  if (p.age < 0) return;
  const drag = Math.pow(p.drag, dt);
  p.vx *= drag;
  p.vy = p.vy * drag + p.gravity * dt;
  if (p.maxFall !== undefined) p.vy = Math.min(p.vy, p.maxFall);
  const sway = p.sway === undefined ? 0 : Math.sin(p.sway + p.age / 25) * 0.8;
  p.x += (p.vx + sway) * dt;
  p.y += p.vy * dt;
  p.rot += p.vr * dt;
  if (p.flip !== undefined) p.flip += (p.flipSpeed ?? 0) * dt;

  let fade = Math.min(1, (p.life - p.age) / 30) * alpha;
  // Scintillement sous 3 Hz (0,28 rad par image à 60 Hz) : en dessous du seuil de clignotement des WCAG (2.3.1).
  if (p.twinkle !== undefined && p.age > p.life * 0.55) fade *= 0.55 + 0.45 * Math.sin(p.twinkle + p.age * 0.28);
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  draw(ctx, p);
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, p: Particle) {
  if (p.shape === "spark") {
    // Traînée : un trait vers la position d'il y a quelques images.
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x - p.vx * 3, p.y - p.vy * 3);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    return;
  }
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  if (p.shape === "text") return drawText(ctx, p.text ?? "", p.size);
  ctx.fillStyle = p.color;
  // Le confetti se retourne : écrasé puis déplié, il papillonne.
  if (p.flip !== undefined) ctx.scale(1, Math.cos(p.flip));
  if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
  else {
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawText(ctx: CanvasRenderingContext2D, text: string, size: number) {
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
}

interface Rocket { x: number; y: number; exploded: boolean }

/** La fusée traverse l'écran en diagonale en laissant une traînée, puis explose : renvoie les particules à ajouter. */
function rocketStep(ctx: CanvasRenderingContext2D, elapsed: number, dt: number, w: number, h: number, rocket: Rocket): Particle[] {
  if (rocket.exploded) return [];
  if (elapsed >= ROCKET_MS) {
    rocket.exploded = true;
    return [...firework(rocket.x, rocket.y, 0, 1.2), ...firework(rocket.x, rocket.y, 8, 1.8)];
  }
  const t = elapsed / ROCKET_MS;
  const x = -60 + (w * 0.75 + 60) * t;
  const y = h + 60 - (h * 0.8 + 60) * t * (2 - t);
  const angle = Math.atan2(y - rocket.y, x - rocket.x);
  rocket.x = x;
  rocket.y = y;
  ctx.save();
  ctx.translate(x, y);
  // L'emoji 🚀 pointe vers le haut à droite (-45°) : on l'oriente dans le sens de la trajectoire.
  ctx.rotate(angle + Math.PI / 4);
  drawText(ctx, "🚀", 56);
  ctx.restore();
  return Array.from({ length: Math.max(1, Math.round(3 * dt)) }, () => ({
    x: x - 16 * Math.cos(angle), y: y - 16 * Math.sin(angle), vx: rnd(-1.5, 1.5) - Math.cos(angle) * 2, vy: rnd(-1.5, 1.5) - Math.sin(angle) * 2,
    rot: 0, vr: 0, size: rnd(3, 6), color: any(FLAME), shape: "circle" as const, age: 0, life: rnd(25, 45), gravity: 0.02, drag: 0.94,
  }));
}

/** Joue le spectacle sur le canvas ; renvoie de quoi l'arrêter. */
function play(canvas: HTMLCanvasElement, c: CelebrationData, duration: number): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const emojis = kindEmojis(c.kind);
  const shows = schedule(c.effect, c.tier).map((s) => ({ ...s, started: false, rocket: { x: -60, y: h + 60, exploded: false } }));
  let particles: Particle[] = [];
  let start = 0;
  let last = 0;
  let raf = 0;

  function tick(now: number) {
    start ||= now;
    // Écart plafonné : un onglet en arrière-plan ne doit pas tout faire sauter d'un coup au retour.
    const dt = Math.min(3, (now - (last || now)) / FRAME_MS || 1);
    last = now;
    const elapsed = now - start;
    const alpha = Math.max(0, Math.min(1, (duration - elapsed) / FADE));
    ctx!.clearRect(0, 0, w, h);
    for (const s of shows) {
      if (elapsed < s.at) continue;
      if (!s.started) particles.push(...launch(s.effect, w, h, emojis, c.surprise));
      s.started = true;
      if (s.effect === "rocket") particles.push(...rocketStep(ctx!, elapsed - s.at, dt, w, h, s.rocket));
    }
    for (const p of particles) step(ctx!, p, dt, alpha);
    // Sous le bord : seulement ce qui tombe (les ballons partent de plus bas et montent).
    particles = particles.filter((p) => p.age < p.life && p.y > -200 && (p.y < h + 120 || p.vy < 0));
    if (elapsed < duration) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Mode dev uniquement : déclenche une célébration au hasard pour la voir sans atteindre de palier. */
export function DevCelebrationButton() {
  const preview = useCelebrationStore((s) => s.preview);
  return (
    <button
      onClick={preview}
      title="Célébration au hasard (mode dev)"
      className="fixed bottom-3 left-3 z-[10001] px-2 py-1 rounded-md border border-dashed border-[var(--color-accent)]/60 bg-[var(--color-bg-elevated)]/90 text-[11px] opacity-60 hover:opacity-100"
    >
      🎉 dev
    </button>
  );
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Nombre qui défile de 0 à `target` (ralentit à l'arrivée). */
function CountUp({ target, ms }: { target: number; ms: number }) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return <span className="tabular-nums">{value}</span>;
}

/** Titre dont le nombre du palier défile. */
function Title({ c }: { c: CelebrationData }) {
  const n = String(c.count);
  const at = c.surprise ? -1 : c.title.indexOf(n);
  if (at < 0) return <>{c.title}</>;
  return (
    <>
      {c.title.slice(0, at)}
      <CountUp target={c.count} ms={c.tier === 2 ? 1600 : 900} />
      {c.title.slice(at + n.length)}
    </>
  );
}

const BANNER_BORDER: Record<Tier, string> = {
  0: "border-[var(--color-accent)]/50",
  1: "border-[var(--color-accent)] celebrate-glow",
  2: "border-amber-400 border-2 celebrate-glow celebrate-gold",
};

/** Ajoute un point final si la phrase n'a pas déjà sa ponctuation (« ! », « ? »…). */
const sentence = (text: string) => (/[.!?…]$/.test(text.trim()) ? text : `${text}.`);

/** Animation festive d'un palier, par-dessus toute l'interface ; ne bloque pas les clics. */
export function Celebration() {
  const current = useCelebrationStore((s) => s.current);
  const dismiss = useCelebrationStore((s) => s.dismiss);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Échap ferme la célébration, avant toute autre fenêtre (WCAG 2.2.2 : un contenu animé doit pouvoir être arrêté).
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current, dismiss]);

  useEffect(() => {
    if (!current) return;
    const duration = durationOf(current);
    const stop = canvas.current && !reducedMotion() ? play(canvas.current, current, duration) : () => {};
    const timer = window.setTimeout(dismiss, duration);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [current, dismiss]);

  // Zone d'annonce toujours présente : une zone créée en même temps que son texte n'est souvent pas lue.
  const announcement = current ? `${sentence(current.title)} ${current.reason} ${sentence(current.next)}` : "";
  const live = <div role="status" aria-live="polite" className="sr-only">{announcement}</div>;
  if (!current) return live;
  const duration = durationOf(current);
  const progress = Math.min(100, (current.count / current.nextCount) * 100);
  return (
    <div className="fixed inset-0 z-[10002] pointer-events-none" style={{ "--celebrate-ms": `${duration}ms` } as React.CSSProperties}>
      {live}
      <canvas ref={canvas} className="absolute inset-0 w-full h-full" aria-hidden />
      {current.effect === "trophy" && current.tier < 2 && !current.surprise && (
        <div className="absolute left-1/2 top-[42%] text-[96px] leading-none celebrate-trophy celebrate-emoji" aria-hidden>🏆</div>
      )}
      {/* Doublon visuel de la zone d'annonce : masqué aux lecteurs d'écran ; Échap ou un clic le ferme. */}
      <div
        key={current.id}
        aria-hidden
        title="Cliquer ou Échap pour fermer"
        onClick={dismiss}
        className={`pointer-events-auto cursor-pointer absolute left-1/2 top-6 celebrate-banner overflow-hidden flex items-center gap-3 pl-4 pr-5 pt-3 pb-3.5 rounded-xl border bg-[var(--color-bg-elevated)]/95 shadow-2xl w-max max-w-[min(520px,90vw)] ${BANNER_BORDER[current.tier]}`}
      >
        <span className="text-3xl leading-none celebrate-emoji celebrate-bounce">{current.emoji}</span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="font-semibold text-sm text-[var(--color-text)]"><Title c={current} /></span>
          <span className="text-[11px] text-[var(--color-text)]/85">{current.reason}</span>
          <span className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
            <span className="flex-1 h-1 min-w-16 rounded-full bg-overlay/10 overflow-hidden">
              <span
                className="block h-full rounded-full bg-[var(--color-accent)] celebrate-fill"
                style={{ "--fill": `${progress}%` } as React.CSSProperties}
              />
            </span>
            <span className="shrink-0">{current.next}</span>
            <span className="shrink-0 font-mono tabular-nums">{current.count} / {current.nextCount}</span>
          </span>
        </span>
        <span className="absolute left-0 bottom-0 h-[2px] w-full bg-[var(--color-accent)]/60 celebrate-timer" aria-hidden />
      </div>
    </div>
  );
}
