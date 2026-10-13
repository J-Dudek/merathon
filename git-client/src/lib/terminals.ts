import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalClose, terminalOpen, terminalResize, terminalWrite, type TerminalEvent } from "../ipc/commands";
import { useRepoStore } from "../store/useRepoStore";
import { useTabsStore } from "../store/useTabsStore";
import { useUiStore } from "../store/useUiStore";
import { useDisplayStore } from "../store/useDisplayStore";
import { errorMessage } from "./actions";
import { themeColor, useThemeStore } from "./theme";

/**
 * Terminaux intégrés, un par onglet de dépôt. Ils vivent hors de React : changer d'onglet ou
 * replier le panneau détache seulement leur élément, le shell continue de tourner.
 */
interface Session {
  path: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  ptyId: number | null;
  /** Numéro du shell courant : les événements d'un shell remplacé sont ignorés. */
  generation: number;
  starting: boolean;
  exited: boolean;
  disposed: boolean;
  /** Une commande a été validée (Entrée) : on rafraîchira le dépôt quand sa sortie s'arrêtera. */
  awaitingRefresh: boolean;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<number, Session>();

/** Délai sans sortie après lequel on considère la commande terminée. */
const QUIET_MS = 700;

/** Couleurs du terminal, prises dans le thème affiché. */
function terminalTheme(): ITheme {
  const light = useThemeStore.getState().theme === "light";
  return {
    background: themeColor("--color-bg-primary", "#1a1b26"),
    foreground: themeColor("--color-text", "#e2e8f0"),
    cursor: themeColor("--color-accent", "#e94560"),
    selectionBackground: light ? "#1e233333" : "#ffffff33",
    // Couleurs ANSI : celles par défaut de xterm sont prévues pour un fond sombre (jaune, blanc illisibles en clair).
    ...(light && {
      black: "#1e2333", white: "#5f6b80", brightWhite: "#3b4252",
      yellow: "#a16207", brightYellow: "#854d0e", green: "#15803d", brightGreen: "#166534",
      cyan: "#0e7490", brightCyan: "#155e75",
    }),
  };
}

function fitSafe(s: Session) {
  try {
    if (s.host.clientWidth > 0 && s.host.clientHeight > 0) s.fit.fit();
  } catch {
    // élément pas encore mesurable
  }
}

function refreshLater(s: Session) {
  clearTimeout(s.refreshTimer);
  s.refreshTimer = setTimeout(() => {
    s.awaitingRefresh = false;
    const repo = useRepoStore.getState();
    if (repo.repoPath === s.path && !useUiStore.getState().busy) repo.refresh().catch(() => {});
  }, QUIET_MS);
}

function onEvent(s: Session, generation: number, event: TerminalEvent) {
  if (s.disposed || generation !== s.generation) return;
  if (event.kind === "output") {
    s.term.write(event.data);
    if (s.awaitingRefresh) refreshLater(s);
    return;
  }
  s.exited = true;
  s.ptyId = null;
  const code = event.code !== null ? ` (code ${event.code})` : "";
  s.term.write(`\r\n\x1b[90m[Shell terminé${code} — Entrée pour relancer]\x1b[0m\r\n`);
  if (s.awaitingRefresh) refreshLater(s);
}

function start(s: Session) {
  const generation = ++s.generation;
  s.starting = true;
  s.exited = false;
  terminalOpen(s.path, s.term.cols, s.term.rows, (e) => onEvent(s, generation, e))
    .then((id) => {
      if (s.disposed || generation !== s.generation) terminalClose(id).catch(() => {});
      else if (!s.exited) s.ptyId = id;
    })
    .catch((e) => {
      s.exited = true;
      console.error("Terminal :", e);
      s.term.write(`\x1b[31m${errorMessage(e)}\x1b[0m\r\n`);
      useUiStore.getState().notify("error", `Terminal : ${errorMessage(e)}`);
    })
    .finally(() => {
      if (generation === s.generation) s.starting = false;
    });
}

function createSession(path: string): Session {
  const term = new Terminal({
    fontFamily: "ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
    fontSize: useDisplayStore.getState().terminalFontSize,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const host = document.createElement("div");
  host.className = "h-full w-full";
  const s: Session = { path, term, fit, host, ptyId: null, generation: 0, starting: false, exited: false, disposed: false, awaitingRefresh: false };

  // Copier / coller façon terminal Linux : Ctrl+Maj+C / Ctrl+Maj+V (Ctrl+C reste l'interruption).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
    const key = e.key.toLowerCase();
    if (key === "c") {
      const text = term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
      return false;
    }
    if (key === "v") {
      navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => {});
      return false;
    }
    return true;
  });

  term.onData((data) => {
    if (s.exited) {
      if (data.includes("\r") && !s.starting) {
        term.reset();
        start(s);
      }
      return;
    }
    if (s.ptyId === null) return; // shell en cours de démarrage
    if (/[\r\n]/.test(data)) s.awaitingRefresh = true;
    terminalWrite(s.ptyId, data).catch(() => {});
  });
  term.onResize(({ cols, rows }) => {
    if (s.ptyId !== null) terminalResize(s.ptyId, cols, rows).catch(() => {});
  });
  return s;
}

function dispose(tabId: number) {
  const s = sessions.get(tabId);
  if (!s) return;
  s.disposed = true;
  clearTimeout(s.refreshTimer);
  if (s.ptyId !== null) terminalClose(s.ptyId).catch(() => {});
  s.term.dispose();
  s.host.remove();
  sessions.delete(tabId);
}

/**
 * Affiche le terminal de l'onglet dans `container` (en le lançant au besoin) ; renvoie la fonction
 * qui le détache sans l'arrêter. Un onglet passé sur un autre dépôt reçoit un nouveau shell.
 */
export function attachTerminal(tabId: number, path: string, container: HTMLElement): () => void {
  let s = sessions.get(tabId);
  if (s && s.path !== path) {
    dispose(tabId);
    s = undefined;
  }
  if (!s) {
    s = createSession(path);
    sessions.set(tabId, s);
  }
  const session = s;
  container.appendChild(session.host);
  if (!session.term.element) session.term.open(session.host);
  fitSafe(session);
  if (session.ptyId === null && !session.starting && !session.exited) start(session);

  const observer = new ResizeObserver(() => fitSafe(session));
  observer.observe(container);
  session.term.focus();
  return () => {
    observer.disconnect();
    session.host.remove();
  };
}

/** Relance le shell de l'onglet (après un `exit` ou s'il est bloqué). */
export function restartTerminal(tabId: number) {
  const s = sessions.get(tabId);
  if (!s) return;
  if (s.ptyId !== null) terminalClose(s.ptyId).catch(() => {});
  s.ptyId = null;
  s.term.reset();
  start(s);
}

// Taille du texte changée dans les réglages d'affichage : appliquée aux terminaux ouverts.
useDisplayStore.subscribe((state, prev) => {
  if (state.terminalFontSize === prev.terminalFontSize) return;
  for (const s of sessions.values()) {
    s.term.options.fontSize = state.terminalFontSize;
    fitSafe(s);
  }
});

// Thème changé : appliqué aux terminaux ouverts.
useThemeStore.subscribe((state, prev) => {
  if (state.theme === prev.theme) return;
  const theme = terminalTheme();
  for (const s of sessions.values()) s.term.options.theme = theme;
});

// Onglet fermé : son shell aussi.
useTabsStore.subscribe((state) => {
  for (const id of [...sessions.keys()]) {
    if (!state.tabs.some((t) => t.id === id)) dispose(id);
  }
});
