import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("ne ferme que la fenêtre du dessus avec Échap", () => {
    const below = vi.fn();
    const above = vi.fn();
    const { rerender } = render(<Modal title="Dessous" onClose={below}>x</Modal>);
    rerender(<Modal title="Dessous" onClose={below}><Modal title="Dessus" onClose={above}>x</Modal></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();

    rerender(<Modal title="Dessous" onClose={below}>x</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(below).toHaveBeenCalledTimes(1);
  });
});
