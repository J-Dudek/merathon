import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Clock, Smile } from "lucide-react";
import { caretPosition } from "../lib/caret";
import { EMOJI_CATEGORIES, emojiQueryAt, emojisOfCategory, insertEmoji, recentEmojis, rememberEmoji, searchEmojis, type EmojiQuery } from "../lib/emoji";

const MAX_SUGGESTIONS = 8;
const SUGGESTIONS_WIDTH = 280;
const SUGGESTIONS_HEIGHT = 240;
const PICKER_WIDTH = 328;
const PICKER_HEIGHT = 340;
const PICKER_COLUMNS = 8;
const RECENT = "recent";
const EDGE = 4;
/** Au-dessus des fenêtres (voir Modal). */
const Z_INDEX = 10001;

/**
 * Position d'une liste flottante : sous `bottom` si elle y tient, sinon au-dessus de `top`. Elle est affichée dans un portail,
 * car les fenêtres et les panneaux coupent ce qui dépasse.
 */
function floatingStyle(top: number, bottom: number, left: number, width: number, height: number): CSSProperties {
  const clampedLeft = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
  const vertical = bottom + height <= window.innerHeight || top < height
    ? { top: bottom }
    : { bottom: window.innerHeight - top };
  return { position: "fixed", left: clampedLeft, width, zIndex: Z_INDEX, ...vertical };
}

/** Sélecteur d'emojis : recherche, emojis récents et catégories. Le focus reste dans la recherche, les flèches parcourent la grille. */
function EmojiPicker({ style, onPick, onClose }: { style: CSSProperties; onPick: (emoji: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [text, setText] = useState("");
  const [tab, setTab] = useState<string>(RECENT);
  const [active, setActive] = useState(0);
  const query = text.trim();
  const emojis = useMemo(() => {
    if (query) return searchEmojis(query);
    return tab === RECENT ? recentEmojis() : emojisOfCategory(tab);
  }, [query, tab]);
  const current = Math.min(active, emojis.length - 1);
  const shown = emojis[current];

  useEffect(() => {
    search.current?.focus();
    function onMouseDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    if (shown) document.getElementById(`${listId}-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current, shown, listId]);

  function move(step: number) {
    setActive(Math.max(0, Math.min(current + step, emojis.length - 1)));
  }

  function onKeyDown(e: KeyboardEvent) {
    // Le sélecteur est un portail : ses touches ne doivent déclencher ni la fenêtre, ni le champ, ni les raccourcis de l'application.
    e.stopPropagation();
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -PICKER_COLUMNS, ArrowDown: PICKER_COLUMNS };
    if (e.key in steps) {
      e.preventDefault();
      move(steps[e.key]);
    } else if (e.key === "Enter" && e.target === search.current) {
      e.preventDefault();
      if (shown) onPick(shown.emoji);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  function selectTab(id: string) {
    setTab(id);
    setText("");
    setActive(0);
    search.current?.focus();
  }

  const tabClass = (selected: boolean) =>
    `w-7 h-7 shrink-0 flex items-center justify-center rounded text-sm ${selected ? "bg-overlay/15" : "hover:bg-overlay/10"}`;

  return createPortal(
    <div
      ref={box}
      style={style}
      role="dialog"
      aria-label="Choisir un emoji"
      className="flex flex-col rounded-lg border border-overlay/10 bg-[var(--color-bg-elevated)] shadow-2xl"
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={search}
        type="text"
        role="combobox"
        aria-label="Rechercher un emoji"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={shown ? `${listId}-${current}` : undefined}
        className="m-2 mb-1 px-2 py-1 rounded bg-shade/30 border border-overlay/50 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60 placeholder:text-[var(--color-muted)]"
        placeholder="Rechercher (fusée, heart, bug…)"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
      />
      <div className="flex gap-0.5 px-2 pb-1 border-b border-overlay/10">
        <button type="button" className={tabClass(!query && tab === RECENT)} aria-label="Récents" aria-pressed={!query && tab === RECENT} title="Récents" onClick={() => selectTab(RECENT)}>
          <Clock size={14} className="text-[var(--color-muted)]" aria-hidden="true" />
        </button>
        {EMOJI_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={tabClass(!query && tab === c.id)} aria-label={c.label} aria-pressed={!query && tab === c.id} title={c.label} onClick={() => selectTab(c.id)}>
            <span aria-hidden="true">{c.icon}</span>
          </button>
        ))}
      </div>
      <div id={listId} role="listbox" aria-label="Emojis" className="grid grid-cols-8 gap-0.5 p-2 h-56 content-start overflow-y-auto">
        {emojis.map((e, i) => (
          <button
            key={e.emoji}
            id={`${listId}-${i}`}
            type="button"
            role="option"
            aria-selected={i === current}
            aria-label={e.names[0].replace(/_/g, " ")}
            tabIndex={-1}
            className={`h-8 flex items-center justify-center rounded text-lg leading-none ${i === current ? "bg-overlay/15" : "hover:bg-overlay/10"}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(e.emoji)}
          >
            {e.emoji}
          </button>
        ))}
        {emojis.length === 0 && <p className="col-span-8 p-2 text-xs text-center text-[var(--color-muted)]">Aucun emoji trouvé</p>}
      </div>
      <p className="px-2 py-1 border-t border-overlay/10 text-[10px] text-[var(--color-muted)] truncate" aria-live="polite">
        {shown ? `:${shown.names[0]}: · ${shown.description}` : " "}
      </p>
    </div>,
    document.body,
  );
}

/**
 * Saisie d'emojis pour un champ de texte : « :mot » propose les emojis correspondants, et un bouton ouvre le sélecteur.
 * L'emoji est inséré tel quel, et non en code « :tada: », pour qu'il s'affiche partout, y compris dans `git log`.
 */
export function useEmojiAssist(ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>, value: string, onChange: (value: string) => void) {
  const listId = useId();
  const [query, setQuery] = useState<EmojiQuery | null>(null);
  /** Saisie fermée par Échap (position de son « : ») : la liste ne se rouvre qu'à un autre « : ». */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const [pickerStyle, setPickerStyle] = useState<CSSProperties | null>(null);
  /** Curseur à replacer après l'insertion, une fois le texte rendu. */
  const pendingCaret = useRef<number | null>(null);

  const suggestions = useMemo(() => (query ? searchEmojis(query.query, MAX_SUGGESTIONS) : []), [query]);
  const open = !!query && query.start !== dismissed && suggestions.length > 0;
  const current = Math.min(active, suggestions.length - 1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (pendingCaret.current === null || !el) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value, ref]);

  /** Relit la saisie « :… » sous le curseur et place la liste juste en dessous. */
  function sync() {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const next = caret === el.selectionEnd ? emojiQueryAt(el.value, caret) : null;
    setQuery((prev) => (prev?.start === next?.start && prev?.query === next?.query ? prev : next));
    if (!next) {
      setDismissed(null);
      return;
    }
    if (next.start !== query?.start) setActive(0);
    const rect = el.getBoundingClientRect();
    // Un champ d'une seule ligne défile : la liste s'aligne sur le champ plutôt que sur le curseur.
    const at = el instanceof HTMLTextAreaElement ? caretPosition(el, next.start) : { top: 0, left: 0, height: el.offsetHeight };
    const top = rect.top + Math.max(0, at.top);
    const bottom = rect.top + Math.min(at.top + at.height, el.clientHeight) + 2;
    setPopupStyle(floatingStyle(top, bottom, rect.left + at.left, SUGGESTIONS_WIDTH, SUGGESTIONS_HEIGHT));
  }

  function insert(emoji: string, start: number, end: number, spaceAfter: boolean) {
    const next = insertEmoji(value, start, end, emoji, spaceAfter);
    pendingCaret.current = next.caret;
    rememberEmoji(emoji);
    onChange(next.text);
  }

  function pickSuggestion(emoji: string) {
    const el = ref.current;
    if (!query || !el) return;
    insert(emoji, query.start, el.selectionStart ?? query.start, true);
    setQuery(null);
    // Une sélection signalée avant le rendu relirait l'ancien texte : la saisie remplacée ne doit pas rouvrir la liste.
    setDismissed(query.start);
  }

  /** Traite la touche si la liste est ouverte ; renvoie vrai si le champ ne doit pas la traiter à son tour. */
  function onKeyDown(e: KeyboardEvent): boolean {
    if (!open || e.nativeEvent.isComposing) return false;
    const n = suggestions.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      return true;
    }
    // Ctrl+Entrée garde son rôle dans les formulaires : envoyer.
    if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
      e.preventDefault();
      pickSuggestion(suggestions[current].emoji);
      return true;
    }
    if (e.key === "Escape") {
      e.stopPropagation(); // ferme la liste, pas la fenêtre
      setDismissed(query.start);
      return true;
    }
    return false;
  }

  function togglePicker(button: HTMLElement) {
    if (pickerStyle) {
      closePicker();
      return;
    }
    const rect = button.getBoundingClientRect();
    setQuery(null);
    setPickerStyle(floatingStyle(rect.top - 2, rect.bottom + 2, rect.right - PICKER_WIDTH, PICKER_WIDTH, PICKER_HEIGHT));
  }

  function closePicker() {
    setPickerStyle(null);
    ref.current?.focus();
  }

  const overlay = (
    <>
      <button
        type="button"
        aria-label="Insérer un emoji"
        aria-haspopup="dialog"
        aria-expanded={!!pickerStyle}
        title="Insérer un emoji (ou taper « : » suivi d'un mot)"
        className="absolute top-1 right-3 w-5 h-5 flex items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-overlay/10"
        // Le champ garde son focus et sa sélection : l'emoji s'insère au curseur. Le sélecteur ouvert ne voit pas ce clic comme extérieur.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => togglePicker(e.currentTarget)}
      >
        <Smile size={14} aria-hidden="true" />
      </button>
      {pickerStyle && (
        <EmojiPicker
          style={pickerStyle}
          onClose={closePicker}
          onPick={(emoji) => {
            const el = ref.current;
            setPickerStyle(null);
            if (el) insert(emoji, el.selectionStart ?? value.length, el.selectionEnd ?? value.length, false);
          }}
        />
      )}
      {open && createPortal(
        <div style={popupStyle} className="bg-[var(--color-bg-elevated)] border border-overlay/10 rounded shadow-xl">
          <ul id={listId} role="listbox" aria-label="Emojis" className="max-h-48 overflow-y-auto">
            {suggestions.map((e, i) => (
              <li
                key={e.emoji}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                className={`px-2 py-1 text-xs text-[var(--color-text)] cursor-pointer flex items-center gap-2 ${i === current ? "bg-overlay/15" : "hover:bg-overlay/10"}`}
                // Le champ garde le focus : sa perte fermerait la liste avant le clic.
                onMouseDown={(ev) => ev.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pickSuggestion(e.emoji)}
              >
                <span className="text-base leading-none shrink-0" aria-hidden="true">{e.emoji}</span>
                <span className="truncate">{e.names[0].replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
          <p className="px-2 py-1 border-t border-overlay/10 text-[10px] text-[var(--color-muted)]">Entrée ou Tab : insérer · Échap : fermer</p>
        </div>,
        document.body,
      )}
    </>
  );

  return {
    sync,
    close: () => setQuery(null),
    onKeyDown,
    overlay,
    /** Attributs du champ quand la liste est ouverte. */
    aria: open ? { "aria-autocomplete": "list" as const, "aria-controls": listId, "aria-activedescendant": `${listId}-${current}` } : {},
  };
}

/** Marge du champ, pour que son texte ne passe pas sous le bouton. */
const FIELD_PADDING = "pr-9";

type FieldProps<E extends "textarea" | "input"> = Omit<ComponentProps<E>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

/** Zone de texte où « : » propose des emojis, avec un bouton pour les choisir. */
export function EmojiTextarea({ value, onChange, className, onKeyDown, ...rest }: FieldProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const emoji = useEmojiAssist(ref, value, onChange);
  return (
    <div className="relative flex flex-col">
      <textarea
        {...rest}
        {...emoji.aria}
        ref={ref}
        className={`${className ?? ""} ${FIELD_PADDING}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          emoji.sync();
        }}
        onSelect={emoji.sync}
        onBlur={emoji.close}
        onKeyDown={(e) => {
          if (!emoji.onKeyDown(e)) onKeyDown?.(e);
        }}
      />
      {emoji.overlay}
    </div>
  );
}

/** Champ d'une seule ligne où « : » propose des emojis, avec un bouton pour les choisir. */
export function EmojiInput({ value, onChange, className, onKeyDown, ...rest }: FieldProps<"input">) {
  const ref = useRef<HTMLInputElement>(null);
  const emoji = useEmojiAssist(ref, value, onChange);
  return (
    <div className="relative flex flex-col">
      <input
        {...rest}
        {...emoji.aria}
        ref={ref}
        className={`${className ?? ""} ${FIELD_PADDING}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          emoji.sync();
        }}
        onSelect={emoji.sync}
        onBlur={emoji.close}
        onKeyDown={(e) => {
          if (!emoji.onKeyDown(e)) onKeyDown?.(e);
        }}
      />
      {emoji.overlay}
    </div>
  );
}
