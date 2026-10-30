import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toasts } from "./Toasts";
import { useUiStore } from "../store/useUiStore";

beforeEach(() => {
  vi.useFakeTimers();
  const { toasts, dismiss, holdToasts } = useUiStore.getState();
  toasts.forEach((t) => dismiss(t.id));
  holdToasts(false);
});
afterEach(() => vi.useRealTimers());

const messages = () => useUiStore.getState().toasts.map((t) => t.message);

describe("Toasts", () => {
  it("met en pause pendant le focus, et reprend quand la notification fermée emporte le focus", () => {
    render(<Toasts />);
    act(() => {
      useUiStore.getState().notify("success", "premier");
      useUiStore.getState().notify("success", "second");
    });
    const close = screen.getAllByRole("button", { name: "Fermer la notification" })[0];
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(6000));
    expect(messages()).toEqual(["premier", "second"]);

    // Le bouton disparaît avec sa notification : aucun blur, la pause doit pourtant être levée.
    fireEvent.click(close);
    expect(messages()).toEqual(["second"]);
    act(() => vi.advanceTimersByTime(5000));
    expect(messages()).toEqual([]);

    act(() => useUiStore.getState().notify("info", "suivant"));
    act(() => vi.advanceTimersByTime(5000));
    expect(messages()).toEqual([]);
  });
});
