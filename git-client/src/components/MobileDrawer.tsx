import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { menuSections, type MenuEntry } from "./ContextMenu";
import logoMark from "../assets/logo-mark.webp";
import { tr } from "../i18n";

/** Menu principal sur mobile : tiroir latéral ouvert par le bouton ☰ de la barre du haut. */
export function MobileDrawer({ title, subtitle, items, onClose }: {
  title: string;
  subtitle?: string;
  items: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Le focus entre dans le tiroir, puis revient au bouton qui l'a ouvert.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const drawer = ref.current;
    drawer?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || drawer?.contains(active)) opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[10002]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={tr("Menu du dépôt")}
        className="mobile-drawer absolute inset-y-0 left-0 w-[min(20rem,85vw)] flex flex-col overflow-y-auto rounded-r-2xl bg-[var(--color-bg-elevated)] shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center gap-3 px-4 py-4 border-b border-overlay/10">
          <img src={logoMark} alt="" width={40} height={40} draggable={false} className="w-10 h-10 rounded-xl ring-1 ring-overlay/10 shrink-0 select-none" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-[var(--color-text)] truncate">{title}</p>
            {subtitle && <p className="text-xs text-[var(--color-muted)] truncate">{subtitle}</p>}
          </div>
        </div>
        <div className="p-2">
          {menuSections(items).map((section, s) => (
            <div key={s} className={s > 0 ? "mt-1 pt-1 border-t border-overlay/10" : undefined}>
              {section.header && <p className="px-4 pt-3 pb-1 text-xs font-semibold text-[var(--color-muted)]">{section.header}</p>}
              {section.entries.map((entry, i) => {
                if (entry === "separator") return <div key={i} className="my-1 mx-4 h-px bg-overlay/10" />;
                const Icon = entry.icon;
                return (
                  <button
                    key={i}
                    disabled={entry.disabled}
                    onClick={() => {
                      onClose();
                      entry.action();
                    }}
                    className="w-full min-h-12 flex items-center gap-4 px-4 py-2 rounded-full text-left text-sm text-[var(--color-text)] active:bg-overlay/10 disabled:opacity-40"
                  >
                    {Icon && <Icon size={20} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />}
                    <span className="min-w-0 truncate">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
