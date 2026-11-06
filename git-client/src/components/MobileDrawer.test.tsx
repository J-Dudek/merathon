import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileDrawer } from "./MobileDrawer";

describe("MobileDrawer", () => {
  it("runs the chosen entry and closes", () => {
    const onClose = vi.fn();
    const action = vi.fn();
    render(<MobileDrawer title="Merathon" items={[{ header: "Dépôt" }, { label: "Cloner…", action }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cloner…" }));
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes with Escape, which is what the Android back button sends", () => {
    const onClose = vi.fn();
    render(<MobileDrawer title="Merathon" items={[]} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
