import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, type LucideIcon } from "lucide-react";
import { Kbd } from "./Kbd";
import { nextMenuIndex } from "../lib/keyboardContextMenu";

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Texte secondaire affiché sous le libellé. */
  hint?: string;
  icon?: LucideIcon;
  /** Raccourci clavier affiché à droite, ex. "Ctrl+T". */
  shortcut?: string;
  /** Choix actif d'une liste d'options : coche affichée à droite. */
  checked?: boolean;
}

/** Titre de section. */
export interface MenuHeader {
  header: string;
}

export type MenuEntry = MenuItem | MenuHeader | "separator";

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

interface Props {
  menu: ContextMenuState;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: menu.y, left: menu.x });
  const menuId = useId();

  // Garde le menu dans la fenêtre lorsqu'il est ouvert près d'un bord.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4)),
      left: Math.max(4, Math.min(menu.x, window.innerWidth - width - 4)),
    });
  }, [menu]);

  // Clavier : le premier choix prend le focus ; à la fermeture, il revient à l'élément d'origine
  // (en phase de mise en page, avant qu'une fenêtre ouverte par le choix ne prenne le focus à son tour).
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const menuEl = ref.current;
    menuEl?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || menuEl?.contains(active)) opener?.focus?.();
    };
  }, []);

  function items(): HTMLButtonElement[] {
    return Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
  }

  function focusItem(step: 1 | -1 | "first" | "last") {
    const list = items();
    const next = nextMenuIndex(list.map((b) => !b.disabled), list.indexOf(document.activeElement as HTMLButtonElement), step);
    list[next]?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    // Le menu est un portail : sans cela, ses touches remonteraient au composant qui l'a ouvert (ex. flèches du graphe).
    // Échap continue : c'est l'écouteur du document qui ferme le menu.
    if (e.key !== "Escape") e.stopPropagation();
    const steps: Record<string, 1 | -1 | "first" | "last"> = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };
    if (e.key in steps) {
      e.preventDefault();
      focusItem(steps[e.key]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    top: pos.top,
    left: pos.left,
    zIndex: 9999,
  };

  return createPortal(
    <div
      ref={ref}
      style={style}
      role="menu"
      onKeyDown={onMenuKey}
      className="min-w-48 max-w-[min(40rem,calc(100vw-8px))] max-h-[80vh] overflow-y-auto p-1 rounded-lg border border-overlay/10 bg-[var(--color-bg-elevated)]/95 backdrop-blur-md shadow-2xl shadow-black/50 ring-1 ring-shade/40 select-none"
    >
      {menuSections(menu.items).map((section, s) => {
        const entries = section.entries.map((entry, i) => {
        if (entry === "separator") return <div key={i} role="separator" className="my-1 mx-1 h-px bg-overlay/10" />;
        const Icon = entry.icon;
        return (
          <button
            key={i}
            role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={entry.checked}
            tabIndex={0}
            className={`group w-full flex items-center gap-2.5 text-left px-2 py-1.5 rounded-md text-xs transition-colors outline-none disabled:opacity-40 disabled:cursor-default ${
              entry.danger
                ? "text-red-400 hover:bg-red-500/15 focus-visible:bg-red-500/15"
                : "text-[var(--color-text)] hover:bg-overlay/[0.08] focus-visible:bg-overlay/[0.12]"
            }`}
            disabled={entry.disabled}
            onClick={() => {
              entry.action();
              onClose();
            }}
          >
            {Icon && <Icon size={14} strokeWidth={1.75} className="shrink-0 opacity-70 group-hover:opacity-100" />}
            {/* Libellés renvoyés à la ligne plutôt que tronqués : les noms de branches longs restent lisibles. */}
            <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">
              <span className="block">{entry.label}</span>
              {entry.hint && (
                <span className="block text-[10px] text-[var(--color-muted)] font-mono">{entry.hint}</span>
              )}
            </span>
            {entry.shortcut && <Kbd keys={entry.shortcut} className="ml-4" />}
            {entry.checked && <Check size={14} strokeWidth={2} className="shrink-0 ml-4 text-[var(--color-accent-text)]" aria-hidden />}
          </button>
        );
        });
        if (!section.header) return entries;
        // Titre de section : groupe de choix nommé par ce titre.
        const id = `${menuId}-${s}`;
        return (
          <div key={`g${s}`} role="group" aria-labelledby={id}>
            <div id={id} className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              {section.header}
            </div>
            {entries}
          </div>
        );
      })}
    </div>,
    document.body
  );
}

/** Choix du menu regroupés sous leurs titres de section (le premier groupe peut ne pas en avoir). */
function menuSections(items: MenuEntry[]): { header: string | null; entries: (MenuItem | "separator")[] }[] {
  const sections: { header: string | null; entries: (MenuItem | "separator")[] }[] = [{ header: null, entries: [] }];
  for (const entry of items) {
    if (entry !== "separator" && "header" in entry) sections.push({ header: entry.header, entries: [] });
    else sections[sections.length - 1].entries.push(entry);
  }
  return sections.filter((s) => s.header || s.entries.length);
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  function open(e: React.MouseEvent, items: MenuEntry[]) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function close() {
    setMenu(null);
  }

  return { menu, open, close };
}
