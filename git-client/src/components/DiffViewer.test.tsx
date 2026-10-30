import { describe, it, expect, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiffViewer, findMatches } from "./DiffViewer";
import type { DiffLine, FileDiff } from "../types/git";

const line = (kind: DiffLine["kind"], content: string, n: number): DiffLine => ({
  kind, content, old_lineno: kind === "added" ? null : n, new_lineno: kind === "removed" ? null : n,
});

const diff: FileDiff = {
  path: "src/app.ts",
  is_binary: false,
  hunks: [
    { header: "@@ -1,2 +1,2 @@", old_start: 1, new_start: 1, lines: [line("removed", "const total = 0;", 1), line("added", "let Total = total + 1;", 1)] },
    { header: "@@ -10,1 +10,1 @@", old_start: 10, new_start: 10, lines: [line("context", "return total;", 10)] },
  ],
};

beforeAll(() => {
  // jsdom n'implémente pas le défilement.
  Element.prototype.scrollIntoView = () => {};
});

describe("findMatches", () => {
  it("trouve chaque occurrence sans tenir compte de la casse", () => {
    expect(findMatches(diff, "TOTAL")).toEqual([
      { hunk: 0, line: 0, start: 6 },
      { hunk: 0, line: 1, start: 4 },
      { hunk: 0, line: 1, start: 12 },
      { hunk: 1, line: 0, start: 7 },
    ]);
    expect(findMatches(diff, "")).toEqual([]);
    expect(findMatches(null, "total")).toEqual([]);
  });
});

describe("DiffViewer : recherche dans le fichier", () => {
  it("n'affiche la barre que sur demande", () => {
    render(<DiffViewer diff={diff} loading={false} />);
    expect(screen.queryByRole("searchbox", { name: "Rechercher dans le fichier" })).toBeNull();
  });

  it("surligne les occurrences et passe de l'une à l'autre au clavier", () => {
    const { container } = render(<DiffViewer diff={diff} loading={false} searchable />);
    const input = screen.getByRole("searchbox", { name: "Rechercher dans le fichier" });
    fireEvent.change(input, { target: { value: "total" } });

    expect(container.querySelectorAll("mark")).toHaveLength(4);
    expect(screen.getByRole("status").textContent).toBe("1/4");
    expect(container.querySelector('mark[aria-current="true"]')?.getAttribute("data-match")).toBe("0");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("2/4");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("status").textContent).toBe("4/4");

    fireEvent.change(input, { target: { value: "absent" } });
    expect(screen.getByRole("status").textContent).toBe("Aucun résultat");
  });

  it("Ctrl+F depuis le diff place le focus dans la recherche ; Échap la vide", () => {
    render(<DiffViewer diff={diff} loading={false} searchable />);
    const input = screen.getByRole("searchbox", { name: "Rechercher dans le fichier" }) as HTMLInputElement;
    fireEvent.keyDown(screen.getByRole("region"), { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "total" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });
});
