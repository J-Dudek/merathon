/** Rubrique de panneau latéral : titre en petites capitales, action à droite. */
export function PanelSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-overlay/10 pb-1">
      <div className="flex items-center px-3 pt-2 pb-1">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </div>
  );
}
