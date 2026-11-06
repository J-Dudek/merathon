import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EmojiInput, EmojiTextarea, loadEmojiData } from "./EmojiAssist";

// Données chargées à la demande dans l'application (au repos après le démarrage) : ici, une fois pour toutes.
beforeAll(async () => {
  await loadEmojiData();
});
import { IssueRefTextarea } from "./IssueRefTextarea";

function Harness({ initial = "", onKeyDown, single }: { initial?: string; onKeyDown?: () => void; single?: boolean }) {
  const [value, setValue] = useState(initial);
  const Field = single ? EmojiInput : EmojiTextarea;
  return <Field aria-label="Texte" value={value} onChange={setValue} onKeyDown={onKeyDown} />;
}

function type(text: string) {
  const box = screen.getByLabelText("Texte") as HTMLTextAreaElement;
  box.focus();
  fireEvent.change(box, { target: { value: text } });
  return box;
}

const options = () => screen.queryAllByRole("option");
const openPicker = () => fireEvent.click(screen.getByRole("button", { name: "Insérer un emoji" }));

beforeEach(() => localStorage.clear());

describe("suggestions après « : »", () => {
  it.each([false, true])("insère l'emoji choisi au clavier et replace le curseur (une seule ligne : %s)", (single) => {
    render(<Harness single={single} />);
    const box = type("merci :rocke");
    expect(options()[0].textContent).toContain("rocket");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("merci 🚀 ");
    expect(box.selectionStart).toBe(box.value.length);
    expect(options()).toEqual([]);
  });

  it("insère aussi avec Tab, et parcourt la liste avec les flèches", () => {
    render(<Harness />);
    const box = type(":hear");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    const second = options()[1].querySelector("[aria-hidden]")!.textContent!;
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box.value).toBe(`${second} `);
  });

  it("insère au clic sans que le champ perde le focus", () => {
    render(<Harness />);
    const box = type(":tada");
    const event = fireEvent.mouseDown(options()[0]);
    expect(event).toBe(false); // preventDefault : pas de perte de focus
    fireEvent.click(options()[0]);
    expect(box.value).toBe("🎉 ");
  });

  it("Échap ferme la liste sans la rouvrir, ni transmettre la touche", () => {
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    const box = type(":tada");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(options()).toEqual([]);
    expect(onKeyDown).not.toHaveBeenCalled();
    type(":tadaa");
    expect(options()).toEqual([]);
    expect(box.value).toBe(":tadaa");
  });

  it("laisse Ctrl+Entrée au formulaire, et Entrée quand la liste est fermée", () => {
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    const box = type(":tada");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(box.value).toBe(":tada");
    type("texte");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it("ne s'ouvre pas sur l'heure ou un préfixe de commit", () => {
    render(<Harness />);
    type("fix:bug à 12:30");
    expect(options()).toEqual([]);
  });

  it("cohabite avec les références d'issues", () => {
    function Issues() {
      const [value, setValue] = useState("");
      return <IssueRefTextarea label="Texte" value={value} onChange={setValue} issues={[{ number: 12, title: "Crash", state: "open", author: "", url: "", createdAt: "", labels: [] }]} />;
    }
    render(<Issues />);
    const box = type(":tada");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("🎉 ");
    fireEvent.change(box, { target: { value: "🎉 #" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("🎉 #12 ");
  });
});

describe("sélecteur d'emojis", () => {
  it("insère l'emoji au curseur, sans espace, et rend le focus au champ", () => {
    render(<Harness initial="ab" />);
    const box = screen.getByLabelText("Texte") as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(1, 1);
    openPicker();
    fireEvent.click(screen.getByRole("option", { name: "tada" }));
    expect(box.value).toBe("a🎉b");
    expect(box.selectionStart).toBe(3);
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("recherche, puis insère le premier résultat avec Entrée", () => {
    render(<Harness />);
    openPicker();
    const search = screen.getByRole("combobox", { name: "Rechercher un emoji" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "fusée" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect((screen.getByLabelText("Texte") as HTMLTextAreaElement).value).toBe("🚀");
  });

  it("parcourt la grille avec les flèches, sans sortir de ses limites", () => {
    render(<Harness />);
    openPicker();
    const search = screen.getByRole("combobox", { name: "Rechercher un emoji" });
    const selected = () => options().findIndex((o) => o.getAttribute("aria-selected") === "true");
    fireEvent.keyDown(search, { key: "ArrowLeft" });
    expect(selected()).toBe(0);
    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(selected()).toBe(1);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(selected()).toBe(9);
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(selected()).toBe(1);
  });

  it("change de catégorie, et mémorise le choix dans les récents", () => {
    render(<Harness />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Drapeaux" }));
    fireEvent.click(screen.getByRole("option", { name: "fr" }));
    openPicker();
    expect(within(screen.getByRole("listbox", { name: "Emojis" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["🇫🇷"]);
  });

  it("Échap ferme le sélecteur sans atteindre le formulaire ni le champ, et lui rend le focus", () => {
    const onKeyDown = vi.fn();
    const onParentKey = vi.fn();
    render(<div onKeyDown={onParentKey}><Harness onKeyDown={onKeyDown} /></div>);
    openPicker();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rechercher un emoji" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onParentKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Texte"));
  });

  it("se ferme au clic à l'extérieur, et avec son bouton", () => {
    render(<Harness />);
    openPicker();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    openPicker();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Insérer un emoji" }));
    screen.getByRole("dialog");
    openPicker();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
