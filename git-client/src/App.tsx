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
import { InteractiveRebaseDialog } from "./components/InteractiveRebaseDialog";
import { useRepoStore } from "./store/useRepoStore";
import { useAccountsStore } from "./store/useAccountsStore";
import { defaultSideWidths, useUiStore, type Side } from "./store/useUiStore";
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
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Toolbar onClone={() => setShowClone(true)} />
      <TabBar />

      {/* Remonté à chaque changement d'onglet : pas de sélection d'un dépôt appliquée à un autre. */}
      <div key={activeTab} className="flex flex-1 overflow-hidden">
        <div
          className="relative shrink-0 flex flex-col overflow-hidden border-r border-overlay/10 bg-[var(--color-bg-secondary)]"
          style={{ width: sideWidths.left }}
        >
          <SideResizer side="left" />
          <div className="flex shrink-0 border-b border-overlay/10">
            <LeftTabBtn active={leftTab === "repo"} onClick={() => setLeftTab("repo")}>Dépôt</LeftTabBtn>
            <LeftTabBtn active={leftTab === "accounts"} onClick={() => setLeftTab("accounts")}>Comptes</LeftTabBtn>
          </div>
          <div className="flex-1 overflow-hidden">{leftPane()}</div>
        </div>

        <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-[var(--color-bg-primary)]">
          <div className="flex-1 min-h-0 overflow-hidden">{mainPane()}</div>
          <BottomPanel />
        </main>

        {repoPath && (
          <div className="relative shrink-0 overflow-hidden border-l border-overlay/10" style={{ width: sideWidths.right }}>
            <SideResizer side="right" />
            {rightPane()}
          </div>
        )}
      </div>

      {showClone && <CloneDialog onClose={() => setShowClone(false)} />}
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      {memoOpen && <GitMemoDialog onClose={() => setMemoOpen(false)} />}
      {rebaseBase && repoPath && <InteractiveRebaseDialog base={rebaseBase} onClose={() => setRebaseBase(null)} />}
      <Dialog />
      <Toasts />
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

  return (
    <div
      className={`absolute inset-y-0 ${side === "left" ? "right-0" : "left-0"} w-1 cursor-col-resize z-10 hover:bg-sky-400/40 active:bg-sky-400/60`}
      onPointerDown={startResize}
      onDoubleClick={() => setSideWidth(side, defaultSideWidths[side])}
      title="Redimensionner (double-clic : largeur par défaut)"
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
