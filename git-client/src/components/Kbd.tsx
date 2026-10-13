/** Raccourci clavier affiché comme des touches : "Ctrl+Maj+T" → [Ctrl] [Maj] [T]. */
export function Kbd({ keys, className = "" }: { keys: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 shrink-0 ${className}`}>
      {keys.split("+").map((key, i) => (
        <kbd
          key={i}
          className="min-w-[1.25rem] px-1 h-[18px] inline-flex items-center justify-center rounded border border-overlay/15 border-b-overlay/25 bg-overlay/[0.06] text-[10px] font-sans font-medium leading-none text-[var(--color-muted)]"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
