/**
 * Poignées de redimensionnement au clavier (RGAA 7.3) : flèches, pas de 16 px (64 px avec Maj).
 * Renvoie le déplacement de la poignée dans son axe (positif vers la droite ou vers le bas), ou null pour une autre touche.
 */
export function resizeKeyDelta(e: { key: string; shiftKey: boolean }, axis: "x" | "y"): number | null {
  const step = e.shiftKey ? 64 : 16;
  const keys: Record<string, number> = axis === "x" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
  return keys[e.key] ?? null;
}
