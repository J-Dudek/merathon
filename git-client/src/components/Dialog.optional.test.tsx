import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog } from "./Dialog";
import { useUiStore } from "../store/useUiStore";

describe("Dialog text field", () => {
  afterEach(() => useUiStore.getState().closeDialog(null));

  it("requires a value by default", async () => {
    render(<Dialog />);
    void useUiStore.getState().ask({ title: "T", input: { placeholder: "p" }, confirmLabel: "OK" });
    const ok = await screen.findByRole("button", { name: "OK" });
    expect((ok as HTMLButtonElement).disabled).toBe(true);
  });

  it("confirms an empty optional field (toolbar stash)", async () => {
    render(<Dialog />);
    const answer = useUiStore.getState().ask({ title: "T", input: { placeholder: "p", optional: true }, confirmLabel: "OK" });
    const ok = await screen.findByRole("button", { name: "OK" });
    await waitFor(() => expect((ok as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ok);
    await expect(answer).resolves.toMatchObject({ value: "" });
  });
});
