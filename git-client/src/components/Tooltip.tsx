import { useEffect, useState } from "react";

/**
 * Infobulle affichée sous l'élément survolé ou focalisé au clavier, sans le délai du `title` natif (qui passe inaperçu).
 * Elle se masque au clic (le menu ouvert ne doit pas être recouvert) jusqu'à ce que la souris reparte,
 * et avec Échap (WCAG 1.4.13, RGAA 10.13) ; on peut la survoler sans qu'elle disparaisse.
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
  // Survolée ou contenant le focus : Échap la masque, sans arrêter la touche (elle ferme aussi une fenêtre, un menu…).
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHidden(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const reset = () => {
    setActive(false);
    setHidden(false);
  };

  return (
    <div
      className="relative group flex min-w-0"
      onClickCapture={() => setHidden(true)}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={reset}
      onFocus={() => setActive(true)}
      onBlur={reset}
    >
      {children}
      {/* Marge intérieure plutôt qu'extérieure : pas d'espace entre l'élément et l'infobulle, la souris peut y passer. */}
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-full pt-1.5 z-50 w-max max-w-[420px] opacity-0 transition-opacity delay-200 ${
          align === "left" ? "left-0" : "right-0"
        } ${hidden ? "" : "group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100"}`}
      >
        <div className="rounded-md border border-overlay/10 bg-[var(--color-bg-elevated)] px-2 py-1 text-[11px] font-normal shadow-lg">
          <span className="block text-[var(--color-text)]">{title}</span>
          {lines.map((line, i) => (
            <span key={i} className="block text-[var(--color-muted)] break-all">{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
