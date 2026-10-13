import { useState } from "react";

/**
 * Infobulle affichée sous l'élément survolé, sans le délai du `title` natif (qui passe inaperçu).
 * Elle se masque au clic (le menu ouvert ne doit pas être recouvert) jusqu'à ce que la souris reparte.
 */
export function Tooltip({ title, lines = [], align = "left", children }: {
  title: string;
  /** Lignes secondaires, en plus discret. */
  lines?: React.ReactNode[];
  /** Bord de l'élément sur lequel l'infobulle s'aligne (« right » près du bord droit de la fenêtre). */
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className="relative group flex min-w-0" onClickCapture={() => setHidden(true)} onMouseLeave={() => setHidden(false)}>
      {children}
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-full mt-1.5 z-50 w-max max-w-[420px] rounded-md border border-overlay/10 bg-[var(--color-bg-elevated)] px-2 py-1 text-[11px] font-normal shadow-lg opacity-0 transition-opacity delay-200 ${
          align === "left" ? "left-0" : "right-0"
        } ${hidden ? "" : "group-hover:opacity-100"}`}
      >
        <span className="block text-[var(--color-text)]">{title}</span>
        {lines.map((line, i) => (
          <span key={i} className="block text-[var(--color-muted)] break-all">{line}</span>
        ))}
      </div>
    </div>
  );
}
