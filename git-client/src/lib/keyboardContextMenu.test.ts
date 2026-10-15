import { afterEach, describe, expect, it, vi } from "vitest";
import { contextMenuPoint, isContextMenuKey, listKeyIndex, nextMenuIndex, openContextMenuFromKeyboard } from "./keyboardContextMenu";

afterEach(() => {
  document.body.innerHTML = "";
});

const press = (key: string, shiftKey = false) => {
  const e = new KeyboardEvent("keydown", { key, shiftKey, cancelable: true });
  openContextMenuFromKeyboard(e);
  return e;
};

describe("isContextMenuKey", () => {
  it("reconnaît la touche Menu et Maj+F10", () => {
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
  });
});

describe("contextMenuPoint", () => {
  it("ouvre le menu sous le début de l'élément", () => {
    expect(contextMenuPoint({ left: 100, bottom: 40, width: 300 })).toEqual({ x: 116, y: 40 });
    expect(contextMenuPoint({ left: 100, bottom: 40, width: 10 })).toEqual({ x: 105, y: 40 });
  });
});

describe("openContextMenuFromKeyboard", () => {
  it("envoie un clic droit à l'élément qui a le focus", () => {
    const button = document.body.appendChild(document.createElement("button"));
    const onMenu = vi.fn();
    button.addEventListener("contextmenu", onMenu);
    button.focus();
    expect(press("ContextMenu").defaultPrevented).toBe(true);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("laisse les touches au terminal et aux composants qui les gèrent déjà", () => {
    const term = document.body.appendChild(document.createElement("div"));
    term.className = "xterm";
    const input = term.appendChild(document.createElement("textarea"));
    const onMenu = vi.fn();
    input.addEventListener("contextmenu", onMenu);
    input.focus();
    expect(press("F10", true).defaultPrevented).toBe(false);

    const handled = new KeyboardEvent("keydown", { key: "ContextMenu", cancelable: true });
    handled.preventDefault();
    openContextMenuFromKeyboard(handled);
    expect(onMenu).not.toHaveBeenCalled();
  });
});

describe("nextMenuIndex", () => {
  const enabled = [true, false, true, true];

  it("saute les choix désactivés et boucle", () => {
    expect(nextMenuIndex(enabled, 0, 1)).toBe(2);
    expect(nextMenuIndex(enabled, 3, 1)).toBe(0);
    expect(nextMenuIndex(enabled, 0, -1)).toBe(3);
    expect(nextMenuIndex(enabled, 2, -1)).toBe(0);
    expect(nextMenuIndex(enabled, -1, -1)).toBe(3);
    expect(nextMenuIndex(enabled, -1, 1)).toBe(0);
  });

  it("va au premier ou au dernier choix actif", () => {
    expect(nextMenuIndex([false, true, true, false], -1, "first")).toBe(1);
    expect(nextMenuIndex([false, true, true, false], -1, "last")).toBe(2);
    expect(nextMenuIndex([false, false], 0, 1)).toBe(-1);
  });
});

describe("listKeyIndex", () => {
  it("déplace la sélection avec les flèches, Origine / Fin et Page préc. / suiv.", () => {
    expect(listKeyIndex("ArrowDown", -1, 10, 4)).toBe(0);
    expect(listKeyIndex("ArrowDown", 9, 10, 4)).toBe(9);
    expect(listKeyIndex("ArrowUp", 0, 10, 4)).toBe(0);
    expect(listKeyIndex("End", 2, 10, 4)).toBe(9);
    expect(listKeyIndex("PageDown", 8, 10, 4)).toBe(9);
    expect(listKeyIndex("PageUp", 5, 10, 4)).toBe(1);
  });

  it("ignore les autres touches et les listes vides", () => {
    expect(listKeyIndex("a", 2, 10, 4)).toBeNull();
    expect(listKeyIndex("ArrowDown", -1, 0, 4)).toBeNull();
  });
});
