import { useId, useState } from "react";
import { X } from "lucide-react";
import type { ForgeUser } from "../types/forge";
import { inputClass } from "./Modal";
import { fieldLabel } from "../lib/fieldLabel";

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)]";

/** Sélection de membres du projet (relecteurs, assignés) ; « Moi » ajoute l'utilisateur du compte. */
export function UserPicker({ label, choices, value, onChange, self }: {
  label: string;
  choices: ForgeUser[];
  value: ForgeUser[];
  onChange: (users: ForgeUser[]) => void;
  /** Utilisateur du compte, proposé en raccourci « M'assigner ». */
  self?: ForgeUser;
}) {
  // Les valeurs absentes des choix (ancien membre…) restent sélectionnées.
  const byName = new Map([...choices, ...value].map((u) => [u.username, u]));
  return (
    <TagPicker
      label={label}
      choices={choices.map((u) => ({ key: u.username, label: u.name !== u.username ? `${u.name} (@${u.username})` : `@${u.username}` }))}
      value={value.map((u) => u.username)}
      onChange={(names) => onChange(names.map((n) => byName.get(n)!).filter(Boolean))}
      action={self && !value.some((u) => u.username === self.username)
        ? { label: "Moi", run: () => onChange([...value, self]) }
        : undefined}
    />
  );
}

/** Sélection multiple avec recherche : puces des valeurs choisies + suggestions filtrées. */
export function TagPicker({ label, choices, value, onChange, action }: {
  label: string;
  choices: { key: string; label: string; color?: string }[];
  value: string[];
  onChange: (keys: string[]) => void;
  action?: { label: string; run: () => void };
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  /** Suggestion désignée au clavier (flèches), choisie par Entrée. */
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = query.trim().toLowerCase();
  const suggestions = choices.filter((c) => !value.includes(c.key) && c.label.toLowerCase().includes(q)).slice(0, 8);
  const colorOf = (key: string) => choices.find((c) => c.key === key)?.color;
  const open = focused && suggestions.length > 0;
  const current = Math.min(active, suggestions.length - 1);

  function pick(key: string) {
    onChange([...value, key]);
    setQuery("");
    setActive(0);
  }

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center">
        <span className={labelClass}>{label}</span>
        {action && (
          <button className="ml-auto text-[10px] text-[var(--color-accent-text)] hover:underline" onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
      {/* Champ sous le titre, puces en dessous : les champs de colonnes voisines restent alignés. */}
      <div className="relative">
        {/* Liste de suggestions au clavier : flèches pour choisir, Entrée pour ajouter, Échap pour fermer. */}
        <input
          className={inputClass}
          placeholder={choices.length ? "Rechercher…" : "Aucun choix disponible"}
          {...fieldLabel(`${label} : ajouter`)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${current}` : undefined}
          disabled={!choices.length}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setFocused(true);
              const n = suggestions.length;
              if (n) setActive((current + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              pick(suggestions[current].key);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setFocused(false);
            }
          }}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={`Suggestions : ${label}`}
          className={open ? "absolute z-10 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-[var(--color-bg-elevated)] border border-overlay/10 rounded shadow-xl" : "hidden"}
        >
          {open && suggestions.map((c, i) => (
            <li
              key={c.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className={`px-2 py-1 text-xs text-[var(--color-text)] cursor-pointer flex items-center gap-2 ${i === current ? "bg-overlay/15" : "hover:bg-overlay/10"}`}
              // Le champ garde le focus (la liste resterait sinon fermée avant le clic) ; le choix se fait au relâchement.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c.key)}
            >
              {c.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} aria-hidden />}
              <span className="truncate">{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((key) => (
            <span key={key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-overlay/10 text-[11px] text-[var(--color-text)]">
              {colorOf(key) && <span className="w-2 h-2 rounded-full" style={{ background: colorOf(key) }} aria-hidden />}
              {key}
              <button className="text-[var(--color-muted)] hover:text-[var(--color-text)]" aria-label={`Retirer ${key}`} onClick={() => onChange(value.filter((v) => v !== key))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
