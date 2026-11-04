import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDisplay, useDisplayStore } from "../store/useDisplayStore";
import { LanguageChooser } from "./LanguageChooser";

describe("LanguageChooser", () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    vi.stubGlobal("location", { ...window.location, reload });
    localStorage.clear();
    useDisplayStore.setState({ ...defaultDisplay });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("preselects French and keeps it on confirmation, without reloading", () => {
    render(<LanguageChooser />);
    expect(screen.getByRole("button", { name: "Français" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(useDisplayStore.getState()).toMatchObject({ language: "fr", languageChosen: true });
    expect(reload).not.toHaveBeenCalled();
  });

  it("stores English and reloads the window to apply it", () => {
    render(<LanguageChooser />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(localStorage.getItem("merathon.display")!)).toMatchObject({ language: "en", languageChosen: true });
    expect(reload).toHaveBeenCalled();
  });

  it("keeps French when closed without choosing", () => {
    render(<LanguageChooser />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useDisplayStore.getState()).toMatchObject({ language: "fr", languageChosen: true });
  });

  it("does not ask again once the language is chosen", () => {
    useDisplayStore.setState({ languageChosen: true });
    render(<LanguageChooser />);
    expect(screen.queryByRole("button", { name: "Français" })).toBeNull();
  });

  it("keeps the chosen language when display settings are reset", () => {
    useDisplayStore.setState({ language: "en", languageChosen: true, zoom: 1.5 });
    useDisplayStore.getState().reset();
    expect(useDisplayStore.getState()).toMatchObject({ language: "en", languageChosen: true, zoom: 1 });
  });
});
