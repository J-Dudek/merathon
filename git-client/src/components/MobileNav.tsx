import { FolderGit2, History, ListChecks, type LucideIcon } from "lucide-react";
import { tr } from "../i18n";

/** Écran affiché sur mobile : un seul panneau à la fois, au lieu des trois colonnes du bureau. */
export type MobilePane = "left" | "main" | "right";

/** Barre de navigation du bas, sur mobile : dépôt (branches, comptes), historique, détails du commit ou modifications. */
export function MobileNav({ pane, onChange, hasRepo }: { pane: MobilePane; onChange: (pane: MobilePane) => void; hasRepo: boolean }) {
  const items: { id: MobilePane; label: string; icon: LucideIcon; hidden?: boolean }[] = [
    { id: "left", label: tr("Dépôt"), icon: FolderGit2 },
    { id: "main", label: tr("Historique"), icon: History },
    { id: "right", label: tr("Détails"), icon: ListChecks, hidden: !hasRepo },
  ];
  return (
    <nav aria-label={tr("Écrans de l'application")} className="flex shrink-0 border-t border-overlay/10 bg-[var(--color-bg-secondary)] pb-[env(safe-area-inset-bottom)]">
      {items
        .filter((i) => !i.hidden)
        .map(({ id, label, icon: Icon }) => {
          const active = pane === id;
          return (
            <button
              key={id}
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(id)}
              className={`flex-1 flex flex-col items-center gap-1 pt-2 pb-2 text-[11px] ${active ? "text-[var(--color-text)] font-semibold" : "text-[var(--color-muted)]"}`}
            >
              {/* Pastille de l'élément actif, comme la barre de navigation Material. */}
              <span className={`flex items-center justify-center w-14 h-7 rounded-full transition-colors ${active ? "bg-[var(--color-accent)]/20 text-[var(--color-accent-text)]" : ""}`}>
                <Icon size={20} strokeWidth={1.75} aria-hidden />
              </span>
              {label}
            </button>
          );
        })}
    </nav>
  );
}
