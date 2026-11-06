import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useUiStore, type Toast } from "../store/useUiStore";
import { isMobile } from "../lib/platform";
import { tr } from "../i18n";

const TOAST_STYLES: Record<Toast["kind"], string> = {
  error: "bg-red-950/95 border-red-500/40 text-red-200",
  success: "bg-green-950/95 border-green-500/40 text-green-200",
  info: "bg-[var(--color-bg-info)]/95 border-sky-500/40 text-sky-200",
};

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  const hold = useUiStore((s) => s.holdToasts);
  const ref = useRef<HTMLDivElement>(null);
  const headerBottom = useHeaderBottom();

  // Une notification fermée sous le pointeur ou avec le focus (bouton ×) ne déclenche ni mouseleave ni blur :
  // sans cette vérification, la pause resterait active et plus aucune notification ne disparaîtrait seule.
  useEffect(() => {
    const el = ref.current;
    if (!el || toasts.length === 0) {
      hold(false);
      return;
    }
    let hovered = false;
    try {
      hovered = el.matches(":hover");
    } catch {
      // sélecteur non pris en charge : seul le focus compte
    }
    hold(hovered || el.contains(document.activeElement));
  }, [toasts, hold]);

  return (
    // Les erreurs restent jusqu'à leur fermeture ; les autres disparaissent seules, sauf pendant un survol ou un focus.
    <div
      ref={ref}
      className={`fixed z-[10001] flex flex-col gap-2 ${placement()}`}
      style={isMobile() ? { top: `max(${headerBottom + 8}px, calc(0.75rem + env(safe-area-inset-top)))` } : undefined}
      onMouseEnter={() => hold(true)}
      onMouseLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && hold(false)}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 px-3 py-2 rounded shadow-lg border text-xs ${TOAST_STYLES[t.kind]}`}
        >
          <span className="flex-1 break-words whitespace-pre-line select-text">{t.message}</span>
          <button data-touch-target className="opacity-60 hover:opacity-100 pointer-events-auto" onClick={() => dismiss(t.id)} aria-label={tr("Fermer la notification")}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Mobile : en haut, juste sous la barre d'outils. En bas, elles couvraient le bouton « Commiter » et, clavier ouvert,
 * le champ en cours de saisie.
 */
function placement(): string {
  // Mobile : les touchers traversent les notifications (sauf leur bouton ×) : elles ne bloquent jamais un bouton ou un onglet.
  return isMobile() ? "left-3 right-3 pointer-events-none" : "bottom-3 right-3 w-96 max-w-[90vw]";
}

/** Bas de la barre d'outils (mobile), suivi quand elle change de hauteur (passage à la ligne, rotation). */
function useHeaderBottom(): number {
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    if (!isMobile()) return;
    const header = document.querySelector("header");
    const update = () => setBottom(header ? header.getBoundingClientRect().bottom : 0);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (header) observer?.observe(header);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return bottom;
}
