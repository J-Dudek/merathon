import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreferencesDialog } from "./PreferencesDialog";
import { useUiStore } from "../store/useUiStore";

describe("Préférences › Synchronisation : activité de mes PR / MR", () => {
  beforeEach(() => useUiStore.setState({ preferencesSection: "sync" }));
  afterEach(() => vi.unstubAllEnvs());

  it("bureau : notifications système, pastille de l'icône et notification d'essai", () => {
    render(<PreferencesDialog onClose={() => {}} />);
    expect(screen.getByText("Activer les notifications")).toBeTruthy();
    expect(screen.getByText(/Pastille sur l'icône/)).toBeTruthy();
    expect(screen.getByText("Envoyer une notification d'essai")).toBeTruthy();
  });

  it("NAS : ni notification système ni pastille, l'activité reste signalée par un bandeau", () => {
    vi.stubEnv("VITE_TARGET", "server");
    render(<PreferencesDialog onClose={() => {}} />);
    expect(screen.getByText("Signaler l'activité de mes PR / MR")).toBeTruthy();
    expect(screen.getByText(/La version NAS n'envoie pas de notification système/)).toBeTruthy();
    expect(screen.queryByText("Activer les notifications")).toBeNull();
    expect(screen.queryByText(/Pastille sur l'icône/)).toBeNull();
    expect(screen.queryByText("Envoyer une notification d'essai")).toBeNull();
    // Les autres types d'activité restent réglables.
    expect(screen.getByText(/CI passée ou en échec/)).toBeTruthy();
    // Synchronisation : seulement page ouverte, fetch regroupés par le NAS.
    expect(screen.getByText(/tant qu'une page Merathon est ouverte/)).toBeTruthy();
    expect(screen.getByText(/Le NAS regroupe les pages/)).toBeTruthy();
  });
});

describe("Préférences › Raccourcis : onglets", () => {
  beforeEach(() => useUiStore.setState({ preferencesSection: "shortcuts" }));
  afterEach(() => vi.unstubAllEnvs());

  it("bureau : Ctrl+T, Ctrl+W, Ctrl+Tab", () => {
    render(<PreferencesDialog onClose={() => {}} />);
    const row = (label: string) => screen.getByText(label).parentElement?.textContent;
    expect(row("Nouvel onglet")).toContain("CtrlT");
    expect(row("Fermer l'onglet")).toContain("CtrlW");
    expect(row("Onglet suivant")).toContain("CtrlTab");
    expect(row("Nouvelle fenêtre")).toContain("CtrlMajN");
    expect(screen.queryByText(/restent au navigateur/)).toBeNull();
  });

  it("NAS : Alt, avec l'explication et la confirmation du terminal", () => {
    vi.stubEnv("VITE_TARGET", "server");
    render(<PreferencesDialog onClose={() => {}} />);
    const row = (label: string) => screen.getByText(label).parentElement?.textContent;
    expect(row("Nouvel onglet")).toContain("AltT");
    expect(row("Fermer l'onglet")).toContain("AltW");
    expect(row("Onglet suivant")).toContain("AltPgSuiv");
    expect(row("Onglet précédent")).toContain("AltPgPréc");
    expect(screen.queryByText("Nouvelle fenêtre")).toBeNull();
    expect(screen.getByText(/restent au navigateur : Merathon utilise Alt/)).toBeTruthy();
  });
});

describe("Préférences › Apparence : taille de l'interface", () => {
  beforeEach(() => useUiStore.setState({ preferencesSection: "appearance" }));
  afterEach(() => vi.unstubAllEnvs());

  it("bureau : réglage de Merathon", () => {
    render(<PreferencesDialog onClose={() => {}} />);
    expect(screen.getByRole("slider", { name: "Taille de l'interface" })).toBeTruthy();
  });

  it("NAS : zoom du navigateur, sans second réglage", () => {
    vi.stubEnv("VITE_TARGET", "server");
    render(<PreferencesDialog onClose={() => {}} />);
    expect(screen.queryByRole("slider", { name: "Taille de l'interface" })).toBeNull();
    expect(screen.getByText(/celle du zoom du navigateur/)).toBeTruthy();
  });
});

describe("Préférences › À propos : mises à jour", () => {
  beforeEach(() => useUiStore.setState({ preferencesSection: "about" }));
  afterEach(() => vi.unstubAllEnvs());

  it("NAS : « Rechercher des mises à jour » annonce les nouvelles versions", () => {
    vi.stubEnv("VITE_TARGET", "server");
    render(<PreferencesDialog onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /Rechercher des mises à jour/ })).toBeTruthy();
  });
});
