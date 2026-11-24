import { RefreshCw } from "lucide-react";
import { PULL_THRESHOLD } from "../lib/pullToRefresh";
import { tr } from "../i18n";

/** Pastille qui descend du haut du contenu pendant le tirage, puis tourne le temps de l'actualisation. */
export function PullIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  const visible = distance > 0 || refreshing;
  const ready = distance >= PULL_THRESHOLD;
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-0 z-[60] -translate-x-1/2"
      style={{
        transform: `translate(-50%, ${Math.max(0, distance) - 36}px)`,
        opacity: visible ? Math.min(1, distance / 40 || 1) : 0,
        transition: distance === 0 || refreshing ? "transform 150ms, opacity 150ms" : undefined,
      }}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{refreshing ? tr("Synchronisation en cours…") : ""}</span>
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-overlay/15 bg-[var(--color-bg-elevated)] shadow-lg" aria-hidden>
        <RefreshCw
          size={15}
          className={`text-[var(--color-accent)] ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${Math.min(1, distance / PULL_THRESHOLD) * 270}deg)`, opacity: ready ? 1 : 0.7 }}
        />
      </div>
    </div>
  );
}
