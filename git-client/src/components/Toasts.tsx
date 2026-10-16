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

  return (
    // Les erreurs restent jusqu'à leur fermeture ; les autres disparaissent seules, sauf pendant un survol ou un focus.
    <div
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
