import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MarkdownBody } from "./MarkdownBody";
import { resolveForgeLink } from "../lib/markdown";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

const GITLAB_MR = "https://gitlab.com/groupe/projet/-/merge_requests/12";
const show = (text: string) => render(<MarkdownBody text={text} prUrl={GITLAB_MR} />).container;

describe("MarkdownBody", () => {
  beforeEach(() => vi.mocked(openUrl).mockClear());

  it("interprète le Markdown et les extensions GitHub", () => {
    const view = show("**gras** et `code`\n\n- [x] fait\n\n| a |\n|---|\n| b |\n\n~~barré~~");
    expect(view.querySelector("strong")?.textContent).toContain("gras");
    expect(view.querySelector("code")?.textContent).toContain("code");
    expect(view.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
    expect(view.querySelector("td")?.textContent).toContain("b");
    expect(view.querySelector("del")?.textContent).toContain("barré");
  });

  it("remplace les codes d'emoji, sauf dans le code et s'ils sont inconnus", () => {
    const view = show("Merci :tada: :+1: :inconnu: 12:30:45 `:tada:`\n\n```\n:rocket:\n```");
    expect(view.querySelector("p")?.textContent).toContain("Merci 🎉 👍 :inconnu: 12:30:45 :tada:");
    expect(view.querySelector("p code")?.textContent).toContain(":tada:");
    expect(view.querySelector("pre")?.textContent).toContain(":rocket:");
  });

  it("garde les emojis déjà écrits en Unicode", () => {
    expect(show("Bravo 🎉").querySelector("p")?.textContent).toContain("Bravo 🎉");
  });

  it("place les titres sous ceux de la fenêtre", () => {
    const view = show("# Un\n\n## Deux\n\n### Trois");
    expect(view.querySelector("h1, h2, h3")).toBeNull();
    expect(view.querySelector("h4")?.textContent).toContain("Un");
    expect(view.querySelector("h5")?.textContent).toContain("Deux");
    expect(view.querySelector("h6")?.textContent).toContain("Trois");
  });

  it("ouvre les liens dans le navigateur, et résout les liens relatifs", () => {
    show("[doc](https://exemple.org/doc) et [pièce](/uploads/abc/a.zip)");
    fireEvent.click(screen.getByRole("link", { name: "doc" }));
    expect(openUrl).toHaveBeenCalledWith("https://exemple.org/doc");
    fireEvent.click(screen.getByRole("link", { name: "pièce" }));
    expect(openUrl).toHaveBeenCalledWith("https://gitlab.com/groupe/projet/uploads/abc/a.zip");
  });

  it("n'ouvre pas la page dans l'application au clic sur un lien", () => {
    show("[doc](https://exemple.org/doc)");
    // fireEvent renvoie false quand preventDefault a été appelé.
    expect(fireEvent.click(screen.getByRole("link", { name: "doc" }))).toBe(false);
  });

  it("remplace une image par un lien vers sa source, sans la charger", () => {
    const view = show("![capture](https://exemple.org/a.png)");
    expect(view.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "capture" }));
    expect(openUrl).toHaveBeenCalledWith("https://exemple.org/a.png");
  });

  it("garde un seul lien pour une image dans un lien (badge)", () => {
    const view = show("[![CI](https://exemple.org/badge.svg)](https://exemple.org/ci)");
    expect(view.querySelectorAll("a")).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "CI" }));
    expect(openUrl).toHaveBeenCalledWith("https://exemple.org/ci");
  });

  it("interprète le HTML courant et masque les commentaires des modèles", () => {
    const view = show('<!-- à remplir -->\n\n<details><summary>Plus</summary>\n\nCaché\n\n</details>\n\n<img alt="écran" src="https://exemple.org/e.png">');
    expect(view.textContent).not.toContain("à remplir");
    expect(view.querySelector("details summary")?.textContent).toContain("Plus");
    expect(view.querySelector("img")).toBeNull();
    screen.getByRole("link", { name: "écran" });
  });

  it("neutralise le contenu dangereux", () => {
    const view = show([
      "<script>window.pirate = 1</script>",
      '<img src="x" onerror="window.pirate = 1">',
      '<iframe src="https://exemple.org"></iframe>',
      '<a href="javascript:alert(1)" onclick="window.pirate = 1">piège</a>',
      "[piège2](javascript:alert(1))",
      "[piège3](data:text/html,<script>alert(1)</script>)",
    ].join("\n\n"));
    expect(view.querySelector("script, iframe, [onerror], [onclick]")).toBeNull();
    view.querySelectorAll("a").forEach((a) => expect(a.getAttribute("href")).toMatch(/^https:/));
    expect(view.innerHTML).not.toContain("javascript:");
  });
});

describe("resolveForgeLink", () => {
  it("laisse une adresse absolue telle quelle", () => {
    expect(resolveForgeLink("https://exemple.org/a", GITLAB_MR)).toBe("https://exemple.org/a");
  });

  it("résout depuis le serveur sur GitHub", () => {
    expect(resolveForgeLink("/o/r/pull/2", "https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/2");
  });

  it("ne rattache au projet que les fichiers joints de GitLab", () => {
    expect(resolveForgeLink("/uploads/a.png", GITLAB_MR)).toBe("https://gitlab.com/groupe/projet/uploads/a.png");
    expect(resolveForgeLink("/autre/projet", GITLAB_MR)).toBe("https://gitlab.com/autre/projet");
  });
});
