import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  /** Hauteur fixe (classe), sinon la fenêtre suit son contenu. */
  height?: string;
  /** Fenêtre agrandissable et redimensionnable ; sa taille est mémorisée sous cette clé. */
  resizeKey?: string;
}

/** Taille choisie par l'utilisateur ; sans `width` / `height`, taille par défaut de la fenêtre. */
interface ModalSize {
  width?: number;
  height?: number;
  maximized: boolean;
}

const MIN_WIDTH = 360;
const MIN_HEIGHT = 200;
/** Marge gardée autour de la fenêtre agrandie ou redimensionnée. */
const MARGIN = 16;

const storageKey = (key: string) => `git-client.modal.${key}`;

function loadSize(key?: string): ModalSize {
  if (!key) return { maximized: false };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(key)) ?? "{}") as Partial<ModalSize>;
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
    return { width: num(raw.width), height: num(raw.height), maximized: raw.maximized === true };
  } catch {
    return { maximized: false };
  }
}

function saveSize(key: string, size: ModalSize) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(size));
  } catch {
    // stockage indisponible : taille gardée pour la session
  }
}

export function Modal({ title, onClose, children, width = "w-[420px]", height = "", resizeKey }: Props) {
  const [size, setSize] = useState(() => loadSize(resizeKey));
  const boxRef = useRef<HTMLDivElement>(null);
  const custom = size.width !== undefined;
  const sized = size.maximized || custom;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update(next: ModalSize) {
    setSize(next);
    if (resizeKey) saveSize(resizeKey, next);
  }

  const toggleMaximized = () => update({ ...size, maximized: !size.maximized });

  /** Poignée en bas à droite : la fenêtre restant centrée, elle grandit du double du déplacement. */
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const box = boxRef.current;
    if (!box || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = box.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let next: ModalSize = { width: rect.width, height: rect.height, maximized: false };
    const onMove = (ev: PointerEvent) => {
      next = {
        width: Math.round(Math.min(window.innerWidth - MARGIN, Math.max(MIN_WIDTH, rect.width + 2 * (ev.clientX - start.x)))),
        height: Math.round(Math.min(window.innerHeight - MARGIN, Math.max(MIN_HEIGHT, rect.height + 2 * (ev.clientY - start.y)))),
        maximized: false,
      };
      setSize(next);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      update(next);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  let boxClass = `${width} ${height} max-w-[92vw] max-h-[76vh]`;
  let boxStyle: React.CSSProperties | undefined;
  if (size.maximized) {
    boxClass = "";
    boxStyle = { width: `calc(100vw - ${MARGIN}px)`, height: `calc(100vh - ${MARGIN}px)` };
  } else if (custom) {
    boxClass = "";
    boxStyle = {
      width: size.width, height: size.height,
      maxWidth: `calc(100vw - ${MARGIN}px)`, maxHeight: `calc(100vh - ${MARGIN}px)`,
    };
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[10000] flex justify-center bg-black/50 ${sized ? "items-center" : "items-start pt-[12vh]"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={boxRef}
        className={`${boxClass} relative flex flex-col bg-[var(--color-bg-elevated)] border border-overlay/10 rounded-lg shadow-2xl`}
        style={boxStyle}
      >
        <div
          className="flex items-center justify-between gap-2 pl-4 pr-2 py-2 border-b border-overlay/10"
          onDoubleClick={resizeKey ? toggleMaximized : undefined}
        >
          <span className="text-sm font-semibold text-[var(--color-text)] truncate">{title}</span>
          <div className="flex items-center shrink-0">
            {resizeKey && (
              <HeaderIcon
                onClick={toggleMaximized}
                label={size.maximized ? "Restaurer la taille" : "Agrandir"}
                title={size.maximized ? "Restaurer la taille (double-clic sur le titre)" : "Agrandir (double-clic sur le titre)"}
              >
                {size.maximized ? <Minimize2 size={14} strokeWidth={1.75} /> : <Maximize2 size={14} strokeWidth={1.75} />}
              </HeaderIcon>
            )}
            <HeaderIcon onClick={onClose} label="Fermer" title="Fermer (Échap)">
              <X size={15} strokeWidth={1.75} />
            </HeaderIcon>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {resizeKey && !size.maximized && (
          <div
            className="absolute right-0 bottom-0 w-3.5 h-3.5 cursor-nwse-resize touch-none"
            style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.25) 50%)", borderBottomRightRadius: 8 }}
            title="Redimensionner (double-clic : taille par défaut)"
            onPointerDown={startResize}
            onDoubleClick={() => update({ maximized: false })}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function HeaderIcon({ onClick, label, title, children }: {
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={title}
      className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
    >
      {children}
    </button>
  );
}

export const inputClass =
  "bg-shade/30 border border-overlay/10 rounded px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60 placeholder:text-[var(--color-muted)] w-full";

export function Button({ onClick, disabled, variant = "default", children, title, type = "button" }: {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
  children: React.ReactNode;
  title?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    default: "bg-overlay/10 hover:bg-overlay/15 text-[var(--color-text)]",
    primary: "bg-[var(--color-accent)] hover:opacity-90 text-white font-semibold",
    danger: "bg-red-700/80 hover:bg-red-700 text-white font-semibold",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-default ${styles}`}
    >
      {children}
    </button>
  );
}
