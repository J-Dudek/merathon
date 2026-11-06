import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileNav } from "./MobileNav";

describe("MobileNav", () => {
  it("marks the current screen and switches on tap", () => {
    const onChange = vi.fn();
    render(<MobileNav pane="main" onChange={onChange} hasRepo />);
    expect(screen.getByRole("button", { name: "Historique" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Dépôt" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Détails" }));
    expect(onChange).toHaveBeenCalledWith("right");
  });

  it("hides the details screen when no repository is open", () => {
    render(<MobileNav pane="main" onChange={() => {}} hasRepo={false} />);
    expect(screen.queryByRole("button", { name: "Détails" })).toBeNull();
  });
});
