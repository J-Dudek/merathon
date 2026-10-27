import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IssueRefTextarea } from "./IssueRefTextarea";
import type { ForgeIssue } from "../types/forge";

const issue = (number: number, title: string, state: ForgeIssue["state"] = "open"): ForgeIssue =>
  ({ number, title, state, author: "", url: "", createdAt: "", labels: [] });

const issues = [issue(12, "Crash au démarrage"), issue(7, "Menu illisible")];

function Harness({ search, initial = "" }: { search?: (term: string) => Promise<ForgeIssue[]>; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <IssueRefTextarea label="Description" value={value} onChange={setValue} issues={issues} search={search} />;
}

/** Saisit le texte, curseur en fin (comme le fait jsdom à l'affectation de la valeur). */
function type(text: string) {
  const box = screen.getByLabelText("Description") as HTMLTextAreaElement;
  box.focus();
  fireEvent.change(box, { target: { value: text } });
  return box;
}

const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("IssueRefTextarea", () => {
  it("propose les issues après « # » et les filtre au fil de la saisie", () => {
    render(<Harness />);
    type("voir #");
    expect(options()).toEqual(["#12Crash au démarrage", "#7Menu illisible"]);
    type("voir #men");
    expect(options()).toEqual(["#7Menu illisible"]);
    type("voir #men ");
    expect(options()).toEqual([]);
  });

  it("insère la référence choisie au clavier", () => {
    render(<Harness />);
    const box = type("voir #");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("voir #7 ");
    expect(options()).toEqual([]);
  });

  it("insère « Closes #N » avec Maj+Entrée", () => {
    render(<Harness />);
    const box = type("#cra");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box.value).toBe("Closes #12 ");
  });

  it("ne rouvre pas la liste sur la référence insérée devant un retour à la ligne", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Description") as HTMLTextAreaElement;
    box.focus();
    fireEvent.change(box, { target: { value: "#\nfin", selectionStart: 1, selectionEnd: 1 } });
    expect(options()).toHaveLength(2);
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box.value).toBe("Closes #12\nfin");
    expect(box.selectionStart).toBe(10);
    fireEvent.select(box);
    expect(options()).toEqual([]);
  });

  it("insère au clic, sans perdre le focus", () => {
    render(<Harness />);
    const box = type("#");
    fireEvent.click(screen.getByText("Menu illisible"));
    expect(box.value).toBe("#7 ");
  });

  it("ferme la liste avec Échap sans fermer la fenêtre, jusqu'au prochain « # »", () => {
    const onDocumentKey = vi.fn();
    document.addEventListener("keydown", onDocumentKey);
    render(<Harness />);
    const box = type("#");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(options()).toEqual([]);
    expect(onDocumentKey).not.toHaveBeenCalled();
    type("#1");
    expect(options()).toEqual([]);
    type("#1 #");
    expect(options()).toHaveLength(2);
    document.removeEventListener("keydown", onDocumentKey);
  });

  it("cherche sur la forge ce que les issues chargées ne contiennent pas", async () => {
    const search = vi.fn().mockResolvedValue([issue(301, "Ancienne régression", "closed")]);
    render(<Harness search={search} />);
    const box = type("#301");
    await waitFor(() => expect(options()).toEqual(["#301Ancienne régressionfermée"]));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("301");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("#301 ");
  });

  it("attend la fin de la frappe et ne cherche pas un mot d'une lettre", async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn().mockResolvedValue([]);
      render(<Harness search={search} />);
      type("#x");
      type("#xy");
      type("#xyz");
      await act(async () => vi.advanceTimersByTime(300));
      expect(search.mock.calls).toEqual([["xyz"]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
