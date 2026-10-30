import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useUiStore, type Toast } from "../store/useUiStore";

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
      className="fixed bottom-3 right-3 z-[10001] flex flex-col gap-2 w-96 max-w-[90vw]"
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
          <button className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Fermer la notification">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
