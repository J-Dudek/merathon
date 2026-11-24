import { useEffect, useRef, useState, type RefObject } from "react";
import { PULL_SLOP, PULL_THRESHOLD, canStartPull, isHorizontal, pullDistance, shouldRefresh } from "./pullToRefresh";

/**
 * « Tirer pour actualiser » : tirer vers le bas depuis le haut du contenu de `ref`, relâcher au-delà du seuil lance
 * `onRefresh`. Écouteurs natifs (non passifs) : le défilement ne doit pas suivre le doigt pendant le tirage.
 * Renvoie la course de l'indicateur et si l'actualisation est en cours.
 */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, enabled: boolean, onRefresh: () => Promise<void>) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Dernières valeurs lues par les écouteurs, qui ne sont posés qu'une fois.
  const latest = useRef({ enabled, onRefresh, refreshing });
  latest.current = { enabled, onRefresh, refreshing };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let pulling = false;
    let current = 0;

    function reset() {
      tracking = false;
      pulling = false;
      current = 0;
      setDistance(0);
    }

    function onStart(e: TouchEvent) {
      const { enabled, refreshing } = latest.current;
      tracking = enabled && !refreshing && e.touches.length === 1 && canStartPull(e.target, el!);
      pulling = false;
      if (tracking) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
    }

    function onMove(e: TouchEvent) {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!pulling) {
        if (dy < 0 || isHorizontal(dx, dy)) {
          tracking = false;
          return;
        }
        if (dy < PULL_SLOP) return;
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();
      current = pullDistance(dy - PULL_SLOP);
      setDistance(current);
    }

    function onEnd() {
      if (!pulling) {
        tracking = false;
        return;
      }
      const go = shouldRefresh(current);
      tracking = false;
      pulling = false;
      if (!go) return reset();
      setRefreshing(true);
      setDistance(PULL_THRESHOLD);
      latest.current.onRefresh().catch(() => {}).finally(() => {
        setRefreshing(false);
        reset();
      });
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", reset);
    };
  }, [ref]);

  return { distance, refreshing };
}
