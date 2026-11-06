import { describe, expect, it } from "vitest";
import { backAction, paneAfterCenterChange } from "./androidBack";

describe("backAction", () => {
  const home = { overlayOpen: false, centerIsGraph: true, onHistory: true };

  it("closes what is open first", () => {
    expect(backAction({ overlayOpen: true, centerIsGraph: false, onHistory: false })).toBe("close-overlay");
  });

  it("then leaves a diff, then returns to the history, then exits", () => {
    expect(backAction({ ...home, centerIsGraph: false, onHistory: false })).toBe("show-graph");
    expect(backAction({ ...home, onHistory: false })).toBe("show-history");
    expect(backAction(home)).toBe("exit");
  });
});

describe("paneAfterCenterChange", () => {
  it("ramène à la liste des fichiers du commit quand le diff se referme", () => {
    const opened = paneAfterCenterChange({ pane: "right", returnTo: null }, false);
    expect(opened).toEqual({ pane: "main", returnTo: "right" });
    // Un autre fichier ouvert depuis le diff : le point de retour ne change pas.
    expect(paneAfterCenterChange(opened, false)).toEqual(opened);
    expect(paneAfterCenterChange(opened, true)).toEqual({ pane: "right", returnTo: null });
  });

  it("reste sur l'historique pour un diff ouvert depuis l'historique", () => {
    const opened = paneAfterCenterChange({ pane: "main", returnTo: null }, false);
    expect(opened).toEqual({ pane: "main", returnTo: null });
    expect(paneAfterCenterChange(opened, true)).toEqual({ pane: "main", returnTo: null });
  });

  it("ne change rien quand le graphe reste affiché", () => {
    expect(paneAfterCenterChange({ pane: "left", returnTo: null }, true)).toEqual({ pane: "left", returnTo: null });
  });
});
