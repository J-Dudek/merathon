import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ForgeIssue } from "../types/forge";
import { CLOSING_KEYWORD, insertIssueRef, issueQueryAt, matchIssues, uniqueIssues, type IssueQuery } from "../lib/issueRefs";
import { caretPosition } from "../lib/caret";

const MAX_SUGGESTIONS = 8;
/** Délai avant d'interroger la forge, pour ne pas lancer une requête à chaque touche. */
const SEARCH_DELAY = 300;
const POPUP_WIDTH = 360;

/**
 * Zone de texte Markdown où « # » propose les issues du projet : celles déjà chargées, filtrées sur place, complétées
 * par une recherche sur la forge. Entrée insère `#12`, Maj+Entrée `Closes #12` (issue fermée au merge).
 */
export function IssueRefTextarea({ value, onChange, issues, search, label, className, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  issues: ForgeIssue[];
  /** Recherche côté forge (numéro, ou mots du titre et du corps), quand les issues chargées ne suffisent pas. */
  search?: (term: string) => Promise<ForgeIssue[]>;
  label: string;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [query, setQuery] = useState<IssueQuery | null>(null);
  /** Saisie fermée par Échap (position de son « # ») : la liste ne se rouvre qu'à un autre « # ». */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  /** Résultats de la forge par terme cherché. */
  const [found, setFound] = useState<Record<string, ForgeIssue[]>>({});
  const [searching, setSearching] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  /** Curseur à replacer après l'insertion d'une référence, une fois le texte rendu. */
  const pendingCaret = useRef<number | null>(null);

  const term = query?.query.trim() ?? "";
  const known = uniqueIssues([...issues, ...Object.values(found).flat()]);
  // Les résultats de la forge pour le terme exact restent proposés même si seul leur corps correspond.
  const suggestions = query
    ? uniqueIssues([...matchIssues(known, term, MAX_SUGGESTIONS), ...(found[term] ?? [])]).slice(0, MAX_SUGGESTIONS)
    : [];
  const open = !!query && query.start !== dismissed && (suggestions.length > 0 || searching);
  const current = Math.min(active, suggestions.length - 1);
  const localCount = query ? matchIssues(issues, term, MAX_SUGGESTIONS).length : 0;

  // Recherche sur la forge quand les issues chargées (les plus récentes ouvertes) ne remplissent pas la liste.
  useEffect(() => {
    const worthIt = /^\d+$/.test(term) || term.length >= 2;
    if (!search || !worthIt || term in found || localCount >= MAX_SUGGESTIONS) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      search(term)
        .catch(() => [] as ForgeIssue[])
        .then((list) => !cancelled && setFound((f) => ({ ...f, [term]: list })))
        .finally(() => !cancelled && setSearching(false));
    }, SEARCH_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [search, term, found, localCount]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (pendingCaret.current === null || !el) return;
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  /** Relit la saisie « #… » sous le curseur et place la liste juste en dessous. */
  function sync() {
    const el = ref.current;
    if (!el) return;
    const next = el.selectionStart === el.selectionEnd ? issueQueryAt(el.value, el.selectionStart) : null;
    setQuery((prev) => (prev?.start === next?.start && prev?.query === next?.query ? prev : next));
    if (!next) return;
    if (next.start !== query?.start) setActive(0);
    const caret = caretPosition(el, next.start);
    setPosition({
      top: Math.min(caret.top + caret.height, el.clientHeight) + el.offsetTop + 2,
      left: Math.max(0, Math.min(caret.left, el.clientWidth - POPUP_WIDTH)),
    });
  }

  function pick(issue: ForgeIssue, closing: boolean) {
    const el = ref.current;
    if (!query || !el) return;
    const next = insertIssueRef(value, query, el.selectionStart, issue.number, closing);
    pendingCaret.current = next.caret;
    setQuery(null);
    // Devant un blanc, le curseur reste collé à la référence insérée : elle ne doit pas rouvrir la liste.
    setDismissed(query.start + (closing ? CLOSING_KEYWORD.length + 1 : 0));
    onChange(next.text);
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={open && suggestions.length ? `${listId}-${current}` : undefined}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          sync();
        }}
        onSelect={sync}
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (!open) return;
          const n = suggestions.length;
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
            e.preventDefault();
            setActive((current + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if ((e.key === "Enter" || e.key === "Tab") && n) {
            e.preventDefault();
            pick(suggestions[current], e.key === "Enter" && e.shiftKey);
          } else if (e.key === "Escape") {
            e.stopPropagation(); // ferme la liste, pas la fenêtre
            setDismissed(query!.start);
          }
        }}
      />
      <div
        className={open ? "absolute z-10 bg-[var(--color-bg-elevated)] border border-overlay/10 rounded shadow-xl" : "hidden"}
        style={{ top: position.top, left: position.left, width: POPUP_WIDTH, maxWidth: "100%" }}
      >
        <ul id={listId} role="listbox" aria-label="Issues du projet" className="max-h-48 overflow-y-auto">
          {open && suggestions.map((issue, i) => (
            <li
              key={issue.number}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className={`px-2 py-1 text-xs text-[var(--color-text)] cursor-pointer flex items-center gap-2 ${i === current ? "bg-overlay/15" : "hover:bg-overlay/10"}`}
              // Le champ garde le focus (sa perte fermerait la liste avant le clic) ; Maj+clic insère la fermeture.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => pick(issue, e.shiftKey)}
            >
              <span className="font-mono text-[var(--color-muted)] shrink-0">#{issue.number}</span>
              <span className="truncate">{issue.title}</span>
              {issue.state === "closed" && <span className="ml-auto shrink-0 text-[10px] text-[var(--color-muted)]">fermée</span>}
            </li>
          ))}
        </ul>
        {open && (
          <p className="px-2 py-1 border-t border-overlay/10 text-[10px] text-[var(--color-muted)]" aria-live="polite">
            {suggestions.length
              ? `Entrée : #${suggestions[current].number} · Maj+Entrée : ${CLOSING_KEYWORD} #${suggestions[current].number} (fermée au merge)`
              : "Recherche sur la forge…"}
          </p>
        )}
      </div>
    </div>
  );
}
