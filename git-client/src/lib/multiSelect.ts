/** Sélection multiple d'une liste (commits du graphe, branches de la barre latérale). */
export interface MultiSelection {
  /** Point de départ des plages Maj + clic : dernier élément cliqué sans Maj. */
  anchor: string | null;
  items: string[];
}

export const EMPTY_SELECTION: MultiSelection = { anchor: null, items: [] };

export interface ClickModifiers {
  /** Ctrl / Cmd : ajoute ou retire l'élément. */
  toggle: boolean;
  /** Maj : plage depuis l'ancre (avec Ctrl, ajoutée à la sélection). */
  range: boolean;
}

export const clickModifiers = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): ClickModifiers => ({
  toggle: e.ctrlKey || e.metaKey,
  range: e.shiftKey,
});

interface ClickOptions {
  /** Élément affiché en dehors de la sélection multiple (ex. commit ouvert) : le premier Ctrl / Maj + clic l'inclut. */
  current?: string | null;
  /** Éléments qui ne peuvent pas être sélectionnés (ex. branche courante). */
  selectable?: (item: string) => boolean;
}

/**
 * Sélection après un clic sur `clicked`, `order` étant l'ordre affiché.
 * `plain` est vrai pour un clic simple : la sélection multiple est vidée et l'élément devient l'ancre.
 */
export function clickSelection(
  order: string[],
  selection: MultiSelection,
  clicked: string,
  mods: ClickModifiers,
  { current = null, selectable = () => true }: ClickOptions = {},
): { selection: MultiSelection; plain: boolean } {
  const base = selection.items.length || current === null ? selection.items : [current].filter(selectable);
  const from = order.indexOf(selection.anchor ?? current ?? "");

  if (mods.range && from !== -1) {
    const to = order.indexOf(clicked);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1).filter(selectable);
    const items = mods.toggle ? [...base, ...range.filter((i) => !base.includes(i))] : range;
    return { selection: { anchor: selection.anchor ?? current, items }, plain: false };
  }
  if (mods.toggle) {
    let items = base;
    if (selectable(clicked)) items = base.includes(clicked) ? base.filter((i) => i !== clicked) : [...base, clicked];
    return { selection: { anchor: clicked, items }, plain: false };
  }
  return { selection: { anchor: clicked, items: [] }, plain: true };
}

/** Retire de la sélection les éléments qui n'existent plus (même objet si rien ne change). */
export function pruneSelection(selection: MultiSelection, exists: (item: string) => boolean): MultiSelection {
  const items = selection.items.filter(exists);
  return items.length === selection.items.length ? selection : { ...selection, items };
}
