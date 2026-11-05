import { listen } from "@tauri-apps/api/event";
import { appInfo, setDebugLogging } from "../ipc/commands";
import { debugLog, useDebugLogStore, type DebugLevel, type DebugLogEntry } from "../store/useDebugLogStore";
import { errorMessage } from "./actions";

/** Heure à la milliseconde : l'ordre et l'écart entre deux lignes comptent pour un diagnostic. */
export function logTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Une ligne de log, telle qu'affichée et copiée. */
export function logLine(entry: DebugLogEntry): string {
  return `${logTime(entry.time)} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`;
}

function captureConsole(): () => void {
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => {
    debugLog("warn", args.map(errorMessage).join(" "));
    warn(...args);
  };
  console.error = (...args: unknown[]) => {
    debugLog("error", args.map(errorMessage).join(" "));
    error(...args);
  };
  return () => {
    console.warn = warn;
    console.error = error;
  };
}

function captureUncaught(): () => void {
  const onError = (e: ErrorEvent) => debugLog("error", `uncaught: ${e.message}`);
  const onRejection = (e: PromiseRejectionEvent) => debugLog("error", `unhandled rejection: ${errorMessage(e.reason)}`);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Active la collecte des logs (interface et backend) ; renvoie la fonction qui l'arrête et efface les logs. */
export function startDebugLogging(): () => void {
  const stopConsole = captureConsole();
  const stopUncaught = captureUncaught();
  debugLog("info", "debug mode on");
  appInfo()
    .then((i) => debugLog("info", `system: ${i.os} ${i.arch}, libgit2 ${i.libgit2}`))
    .catch(() => {});

  // Le backend n'émet qu'une fois l'écoute en place : aucune ligne n'est perdue.
  const unlisten = listen<{ level: DebugLevel; message: string }>("debug-log", (e) => debugLog(e.payload.level, e.payload.message));
  unlisten
    .then(() => setDebugLogging(true))
    .catch((e) => console.warn("Debug logs from the backend unavailable:", e));

  return () => {
    stopConsole();
    stopUncaught();
    setDebugLogging(false).catch(() => {});
    unlisten.then((stop) => stop()).catch(() => {});
    useDebugLogStore.getState().clear();
  };
}
