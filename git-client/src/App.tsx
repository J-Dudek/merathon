import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { BottomPanel } from "./components/BottomPanel";
import { Sidebar } from "./components/Sidebar";
import { AccountsPanel } from "./components/AccountsPanel";
import { CommitGraph } from "./graph/CommitGraph";
import { StagingPanel } from "./components/StagingPanel";
import { CommitDetails } from "./components/CommitDetails";
import { CompareDetails } from "./components/CompareDetails";
import { CenterDiff } from "./components/CenterDiff";
import { ConflictViewer } from "./components/ConflictViewer";
import { CloneDialog } from "./components/CloneDialog";
import { Welcome } from "./components/Welcome";
import { Dialog } from "./components/Dialog";
import { Toasts } from "./components/Toasts";
import { Celebration, DevCelebrationButton } from "./components/Celebration";
import { openContextMenuFromKeyboard } from "./lib/keyboardContextMenu";
import { InteractiveRebaseDialog } from "./components/InteractiveRebaseDialog";
import { useRepoStore } from "./store/useRepoStore";
import { useAccountsStore } from "./store/useAccountsStore";
import { defaultSideWidths, SIDE_LIMITS, useUiStore, type Side } from "./store/useUiStore";
import { persistTabSession, useTabsStore } from "./store/useTabsStore";
import { stepZoom, useDisplayStore } from "./store/useDisplayStore";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { GitMemoDialog } from "./components/GitMemoDialog";
import { openNewWindow } from "./ipc/commands";
import { chooseAndOpenRepo as openRepoDialog } from "./lib/repoActions";
import { errorMessage } from "./lib/actions";
import { chooseAndInitRepo, chooseAndOpenRepo, openRepoAt } from "./lib/repoActions";
import { checkForUpdatesOnStartup } from "./lib/updater";
import { startAutoSync } from "./lib/autoSync";
import { useIconBadge } from "./lib/iconBadge";
import { openDevtools } from "./ipc/commands";
import { resizeKeyDelta } from "./lib/resizeKeys";

type LeftTab = "repo" | "accounts";

export default function App() {
  const [leftTab, setLeftTab] = useState<LeftTab>("repo");
  const [showClone, setShowClone] = useState(false);
  const zoom = useDisplayStore((s) => s.zoom);
  const syncInterval = useDisplayStore((s) => s.syncInterval);
  const repoPath = useRepoStore((s) => s.repoPath);
  const center = useRepoStore((s) => s.center);
  const selectedCommit = useRepoStore((s) => s.selectedCommit);
  const comparison = useRepoStore((s) => s.comparison);
  const setCenter = useRepoStore((s) => s.setCenter);
  const refresh = useRepoStore((s) => s.refresh);
  const loadAccounts = useAccountsStore((s) => s.load);
  const notify = useUiStore((s) => s.notify);
  const activeTab = useTabsStore((s) => s.activeId);
  const rebaseBase = useUiStore((s) => s.interactiveRebaseBase);
  const preferencesOpen = useUiStore((s) => s.preferencesOpen);
  const setPreferencesOpen = useUiStore((s) => s.setPreferencesOpen);
  const memoOpen = useUiStore((s) => s.memoOpen);
  const setMemoOpen = useUiStore((s) => s.setMemoOpen);
  const setRebaseBase = useUiStore((s) => s.setInteractiveRebaseBase);
  const sideWidths = useUiStore((s) => s.sideWidths);

  useEffect(() => {
    loadAccounts().catch((e) => notify("error", `Comptes : ${errorMessage(e)}`));
  }, [loadAccounts, notify]);

  // Pas de menu contextuel natif du webview (Recharger, Inspecter…) hors des champs de saisie.
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Touche Menu ou Maj+F10 : menu contextuel de l'élément qui a le focus.
  useEffect(() => {
    window.addEventListener("keydown", openContextMenuFromKeyboard);
    return () => window.removeEventListener("keydown", openContextMenuFromKeyboard);
  }, []);

  useEffect(() => {
    checkForUpdatesOnStartup();
  }, []);

  // Fetch et PR de chaque dépôt ouvert à intervalle régulier (Préférences) : les changements sont notifiés.
  useEffect(() => startAutoSync(syncInterval), [syncInterval]);

  // Nombre de PR / MR avec du nouveau sur l'icône de l'application (Dock, barre des tâches, lanceur).
  useIconBadge();

  // Taille de l'interface : zoom du webview (net, y compris le graphe dessiné en canvas).
  useEffect(() => {
    getCurrentWebview().setZoom(zoom).catch((e) => notify("error", `Zoom : ${errorMessage(e)}`));
  }, [zoom, notify]);

  // Titre de la page (RGAA 8.6) : le dépôt de l'onglet actif, restitué par les technologies d'assistance.
  useEffect(() => {
    const name = repoPath?.split(/[\\/]/).pop();
    document.title = name ? `${name} — Merathon` : "Merathon — Git Repository Manager";
  }, [repoPath]);

  // Fenêtre ouverte sur un dépôt précis (ex. un sous-module) : voir window.rs.
  // La fenêtre principale rouvre les onglets de la session précédente et les mémorise.
  useEffect(() => {
    const repo = (window as { __MERATHON_OPEN_REPO__?: string | null }).__MERATHON_OPEN_REPO__;
    if (repo) openRepoAt(repo);
    if (getCurrentWindow().label === "main") return persistTabSession(!repo);
  }, []);

  // Les fichiers ont pu changer dans un éditeur externe : on rafraîchit au retour sur la fenêtre.
  useEffect(() => {
    if (!repoPath) return;
    const onFocus = () => {
      if (!useUiStore.getState().busy) refresh().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [repoPath, refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Dans le terminal intégré, les touches vont au shell (Ctrl+R, Ctrl+W, Échap…).
      if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
      if (e.key === "Escape" && !useUiStore.getState().dialog && useRepoStore.getState().center.kind !== "graph") {
        setCenter({ kind: "graph" });
      }
      if (e.key === "F12" && import.meta.env.DEV) openDevtools().catch(() => {});
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key === "r")) {
        e.preventDefault();
        refresh().catch((err) => notify("error", errorMessage(err)));
      }
      if (!useUiStore.getState().dialog && windowShortcut(e)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCenter, refresh, notify]);

  function leftPane() {
    if (leftTab === "accounts") return <AccountsPanel />;
    return repoPath ? <Sidebar /> : <p className="p-3 text-xs text-[var(--color-muted)] italic">Aucun dépôt ouvert</p>;
  }

  function rightPaneLabel() {
    if (comparison) return "Comparaison";
    return selectedCommit ? "Détail du commit" : "Modifications en cours";
  }

  function rightPane() {
    if (comparison) return <CompareDetails comparison={comparison} />;
    return selectedCommit ? <CommitDetails commit={selectedCommit} /> : <StagingPanel />;
  }

  function mainPane() {
    if (!repoPath) {
      return (
        <Welcome
          onOpen={chooseAndOpenRepo}
          onInit={chooseAndInitRepo}
          onClone={() => setShowClone(true)}
          onOpenPath={openRepoAt}
        />
      );
    }
    if (center.kind === "diff") return <CenterDiff view={center} />;
    if (center.kind === "conflict") return <ConflictViewer path={center.path} />;
    return <CommitGraph />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden max-[760px]:overflow-y-auto max-[760px]:overflow-x-hidden">
      {/* Lien d'évitement (RGAA 12.7) : premier arrêt de tabulation, visible quand il a le focus. */}
      <a
        href="#contenu"
        onClick={(e) => {
          e.preventDefault();
          // Le graphe (ou la vue centrale) prend le focus : la tabulation reprend depuis le contenu principal.
          const main = document.getElementById("contenu");
          (main?.querySelector<HTMLElement>("[role=listbox], [tabindex='0'], button, input") ?? main)?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10002] focus:px-3 focus:py-2 focus:rounded focus:bg-[var(--color-bg-elevated)] focus:text-[var(--color-text)] focus:text-xs focus:outline-2 focus:outline-[var(--color-accent)]"
      >
        Aller au contenu principal
      </a>
      <Toolbar onClone={() => setShowClone(true)} />
      <TabBar />

      {/* Remonté à chaque changement d'onglet : pas de sélection d'un dépôt appliquée à un autre. */}
      {/* Fenêtre étroite ou zoom fort (RGAA 10.4, 10.11) : les panneaux s'empilent et la page défile verticalement. */}
      <div key={activeTab} className="flex flex-1 overflow-hidden max-[760px]:flex-col max-[760px]:flex-none max-[760px]:overflow-visible">
        <aside
          aria-label={leftTab === "accounts" ? "Comptes" : "Dépôt : branches, tags et stashes"}
          className="relative shrink-0 flex flex-col overflow-hidden border-r border-overlay/10 bg-[var(--color-bg-secondary)] max-[760px]:w-full! max-[760px]:h-80 max-[760px]:border-r-0 max-[760px]:border-b"
          style={{ width: sideWidths.left }}
        >
          <SideResizer side="left" />
          <div role="group" aria-label="Contenu du panneau de gauche" className="flex shrink-0 border-b border-overlay/10">
            <LeftTabBtn active={leftTab === "repo"} onClick={() => setLeftTab("repo")}>Dépôt</LeftTabBtn>
            <LeftTabBtn active={leftTab === "accounts"} onClick={() => setLeftTab("accounts")}>Comptes</LeftTabBtn>
          </div>
          <div className="flex-1 overflow-hidden">{leftPane()}</div>
        </aside>

        <main id="contenu" tabIndex={-1} className="flex-1 min-w-0 overflow-hidden flex flex-col bg-[var(--color-bg-primary)] outline-none max-[760px]:flex-none max-[760px]:h-96">
          <div className="flex-1 min-h-0 overflow-hidden">{mainPane()}</div>
          <BottomPanel />
        </main>

        {repoPath && (
          <aside
            aria-label={rightPaneLabel()}
            className="relative shrink-0 overflow-hidden border-l border-overlay/10 max-[760px]:w-full! max-[760px]:h-96 max-[760px]:border-l-0 max-[760px]:border-t"
            style={{ width: sideWidths.right }}
          >
            <SideResizer side="right" />
            {rightPane()}
          </aside>
        )}
      </div>

      {showClone && <CloneDialog onClose={() => setShowClone(false)} />}
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      {memoOpen && <GitMemoDialog onClose={() => setMemoOpen(false)} />}
      {rebaseBase && repoPath && <InteractiveRebaseDialog base={rebaseBase} onClose={() => setRebaseBase(null)} />}
      <Dialog />
      <Toasts />
      <Celebration />
      {import.meta.env.DEV && <DevCelebrationButton />}
    </div>
  );
}

/** Passe à l'onglet suivant (1) ou précédent (-1). */
function cycleTab(direction: 1 | -1) {
  const tabs = useTabsStore.getState();
  const i = tabs.tabs.findIndex((t) => t.id === tabs.activeId);
  const n = tabs.tabs.length;
  tabs.switchTab(tabs.tabs[(i + direction + n) % n].id);
}

/** Largeur minimale laissée à la zone centrale pendant le redimensionnement d'un panneau latéral. */
const MIN_CENTER_WIDTH = 320;

/** Poignée sur le bord intérieur d'un panneau latéral : tirer pour l'élargir, double-clic pour la largeur par défaut. */
function SideResizer({ side }: { side: Side }) {
  const setSideWidth = useUiStore((s) => s.setSideWidth);
  const sideWidth = useUiStore((s) => s.sideWidths[side]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const { sideWidths } = useUiStore.getState();
    const startX = e.clientX;
    const startWidth = sideWidths[side];
    // Le panneau ne grandit qu'aux dépens de la zone centrale.
    const center = e.currentTarget.parentElement?.parentElement?.querySelector("main")?.clientWidth ?? Infinity;
    const max = startWidth + center - MIN_CENTER_WIDTH;
    const direction = side === "left" ? 1 : -1;
    const move = (ev: PointerEvent) => setSideWidth(side, Math.min(max, startWidth + direction * (ev.clientX - startX)));
    const up = () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Au clavier : flèches gauche / droite (Maj : pas plus grand), Entrée : largeur par défaut.
  function onKeyDown(e: React.KeyboardEvent) {
    const delta = resizeKeyDelta(e, "x");
    if (e.key === "Enter") setSideWidth(side, defaultSideWidths[side]);
    else if (delta === null) return;
    else setSideWidth(side, useUiStore.getState().sideWidths[side] + (side === "left" ? delta : -delta));
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Largeur du panneau de gauche" : "Largeur du panneau de droite"}
      aria-valuenow={sideWidth}
      aria-valuemin={SIDE_LIMITS[side].min}
      aria-valuemax={SIDE_LIMITS[side].max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`absolute inset-y-0 ${side === "left" ? "right-0" : "left-0"} w-1 cursor-col-resize z-10 hover:bg-sky-400/40 active:bg-sky-400/60 focus-visible:bg-[var(--color-accent)] outline-none max-[760px]:hidden`}
      onPointerDown={startResize}
      onDoubleClick={() => setSideWidth(side, defaultSideWidths[side])}
      title="Redimensionner (double-clic ou Entrée : largeur par défaut ; flèches au clavier)"
    />
  );
}

function zoomBy(direction: 1 | -1) {
  const display = useDisplayStore.getState();
  display.update({ zoom: stepZoom(display.zoom, direction) });
}

/** Raccourcis de la fenêtre (avec Ctrl), par touche en minuscules ; "shift+…" quand Maj est enfoncée. */
const SHORTCUTS: Record<string, () => void> = {
  ",": () => useUiStore.getState().setPreferencesOpen(true),
  o: () => openRepoDialog(),
  "shift+n": () => openNewWindow().catch(() => {}),
  "=": () => zoomBy(1),
  "+": () => zoomBy(1),
  "shift++": () => zoomBy(1),
  "-": () => zoomBy(-1),
  "0": () => useDisplayStore.getState().update({ zoom: 1 }),
  j: () => {
    const ui = useUiStore.getState();
    ui.setPanel({ open: !ui.panel.open });
  },
  t: () => useTabsStore.getState().newTab(),
  w: () => {
    const tabs = useTabsStore.getState();
    tabs.closeTab(tabs.activeId);
  },
  tab: () => cycleTab(1),
  "shift+tab": () => cycleTab(-1),
  pagedown: () => cycleTab(1),
  pageup: () => cycleTab(-1),
};

/** Exécute le raccourci correspondant à la touche ; renvoie vrai s'il y en avait un. */
function windowShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey && !e.metaKey) return false;
  const key = e.key.toLowerCase();
  const action = (e.shiftKey && SHORTCUTS[`shift+${key}`]) || SHORTCUTS[key];
  if (!action || (key === "n" && !e.shiftKey)) return false;
  action();
  return true;
}

function LeftTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-2 transition-colors ${
        active
          ? "text-[var(--color-text)] border-b-2 border-[var(--color-accent)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-text)] border-b-2 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}
