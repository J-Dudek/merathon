import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PRRow } from "./PullRequestList";
import type { ForgePR } from "../types/forge";

const pr: ForgePR = {
  number: 12, title: "Formulaire de contact", state: "open", author: "lucas", url: "", createdAt: "", updatedAt: "", headSha: "", draft: false,
  labels: [], sourceBranch: "b", targetBranch: "main", reviewers: [], assignees: [],
};
const row = (props: Partial<React.ComponentProps<typeof PRRow>>) =>
  render(<PRRow pr={pr} freshness={{ kind: "read" }} typeLabel="PR" indent={0} onClick={vi.fn()} onContextMenu={vi.fn()} {...props} />);

describe("PRRow", () => {
  it("place les étiquettes sous le titre, dans une ligne qui peut passer à la ligne", () => {
    row({ freshness: { kind: "updated", commits: true, comments: true }, approved: true });
    const tags = screen.getByText("Approuvée").parentElement!;
    expect(tags.className).toContain("flex-wrap");
    expect(tags.textContent).toContain("commits");
    expect(tags.textContent).toContain("commentaires");
    // La colonne du titre contient les étiquettes : rien ne lui prend sa largeur sur la même ligne.
    const titleColumn = screen.getByText(pr.title).parentElement!;
    expect(titleColumn.contains(tags)).toBe(true);
  });

  it("garde le point d'une PR non lue à droite, sans ligne d'étiquettes vide", () => {
    const { container } = row({ freshness: { kind: "unread" } });
    expect(screen.getByTitle("Non lue").parentElement).not.toBe(screen.getByText(pr.title).parentElement);
    expect(container.querySelector(".flex-wrap")).toBeNull();
  });
});
