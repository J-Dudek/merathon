// Pilotage de Merathon sur un appareil Android (émulateur) : adb pour les gestes, le protocole DevTools (CDP) de la
// WebView pour lire l'interface. Un APK de debug expose sa WebView en CDP ; un APK de release, non.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const PKG = "fr.byj6n.merathon";
/** Paquet des classes Kotlin (namespace), distinct de l'identifiant de l'application. */
export const CODE_PKG = "com.gitclient.app";
export const ACTIVITY = `${PKG}/${CODE_PKG}.MainActivity`;
const CDP_PORT = Number(process.env.E2E_CDP_PORT ?? 9333);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Appareil momentanément injoignable (vu en CI) : la commande n'a pas été exécutée, elle peut être relancée. */
const OFFLINE = /device offline|device '.*' not found|no devices\/emulators found/;

export function adb(...args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("adb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
      if (attempt === 3 || !OFFLINE.test(`${e.stderr ?? ""}${e.message ?? ""}`)) throw e;
      process.stderr.write(`(adb : appareil hors ligne, nouvel essai de « adb ${args.join(" ")} »)\n`);
      execFileSync("adb", ["wait-for-device"], { stdio: "ignore", timeout: 60000 });
    }
  }
}

/** Attend que `fn` renvoie une valeur vraie ; échoue avec `what` après `timeout` ms. */
export async function waitUntil(fn, { timeout = 20000, interval = 300, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}${last ? ` (${last.message ?? last})` : ""}`);
    await sleep(interval);
  }
}

// Exécuté dans la page : éléments visibles dont un libellé (aria-label, title, texte, placeholder, <label>)
// vaut `want`, ou commence par `want` (« ^ » en tête) ; « css: » pour un sélecteur. Le plus petit d'abord.
const FINDER = String.raw`
(want, within, n) => {
  const visible = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== "hidden"; };
  // Conteneur : le dernier visible (fenêtre du dessus, panneau affiché sur mobile).
  const root = within ? [...document.querySelectorAll(within)].filter(visible).pop() : document;
  if (!root) return null;
  let els;
  if (want.startsWith("css:")) els = [...root.querySelectorAll(want.slice(4))].filter(visible);
  else {
    const prefix = want.startsWith("^");
    const text = prefix ? want.slice(1) : want;
    const labels = (e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.innerText, e.textContent, e.placeholder,
      ...[...(e.labels ?? [])].map((l) => l.textContent)].filter(Boolean).map((x) => x.trim());
    const all = [...root.querySelectorAll("button,a,[role=button],[role=menuitem],[role=tab],[role=option],[role=checkbox],label,summary,li,input,select,textarea,span,div,td,p,strong,b,h1,h2,h3,h4")].filter(visible);
    els = all.filter((e) => labels(e).some((l) => (prefix ? l.startsWith(text) : l === text)));
    const area = (e) => { const b = e.getBoundingClientRect(); return b.width * b.height; };
    els.sort((a, b) => area(a) - area(b));
    els = els.filter((e, i) => !els.slice(0, i).some((o) => e.contains(o)));
  }
  return els[n] ?? null;
}`;

export class App {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      this.pending.get(d.id)?.(d);
      this.pending.delete(d.id);
    };
  }

  /** (Re)lance l'application et se connecte à sa WebView. */
  static async launch() {
    adb("shell", "am", "force-stop", PKG);
    adb("shell", "am", "start", "-n", ACTIVITY);
    const pid = await waitUntil(() => adb("shell", "pidof", PKG), { what: "processus de l'application" });
    const socket = `webview_devtools_remote_${pid}`;
    await waitUntil(() => adb("shell", "cat", "/proc/net/unix").includes(socket), { what: "WebView en mode débogage (APK de debug ?)" });
    try {
      adb("forward", "--remove", `tcp:${CDP_PORT}`);
    } catch {
      // pas de redirection précédente
    }
    adb("forward", `tcp:${CDP_PORT}`, `localabstract:${socket}`);
    const page = await waitUntil(async () => {
      const list = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
      return list.find((p) => p.type === "page");
    }, { what: "page de la WebView" });
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const app = new App(ws);
    await waitUntil(() => app.eval("return document.readyState === 'complete' && !!document.querySelector('header')"), { what: "interface chargée" });
    return app;
  }

  close() {
    this.ws.close();
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Évalue le corps d'une fonction asynchrone dans la page et renvoie son résultat (JSON). */
  async eval(body) {
    const r = await this.send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "erreur dans la page");
    return r.result?.result?.value;
  }

  /** Centre de l'élément en pixels de l'écran, après l'avoir fait défiler à l'écran. */
  async locate(want, { within = null, nth = 0 } = {}) {
    return this.eval(`
      const e = (${FINDER})(${JSON.stringify(want)}, ${JSON.stringify(within)}, ${nth});
      if (!e) return null;
      e.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise((r) => setTimeout(r, 200));
      const b = e.getBoundingClientRect();
      return { x: Math.round((b.left + b.width / 2) * devicePixelRatio), y: Math.round((b.top + b.height / 2) * devicePixelRatio) };`);
  }

  /** Touche l'élément (vrai geste, via adb), en l'attendant au besoin. */
  async tap(want, options = {}) {
    const at = await waitUntil(() => this.locate(want, options), { timeout: options.timeout ?? 15000, what: `élément « ${want} »` });
    adb("shell", "input", "tap", String(at.x), String(at.y));
    await sleep(options.settle ?? 400);
  }

  async longPress(want, options = {}) {
    const at = await waitUntil(() => this.locate(want, options), { what: `élément « ${want} »` });
    adb("shell", "input", "swipe", String(at.x), String(at.y), String(at.x), String(at.y), "900");
    await sleep(600);
  }

  /** Saisit du texte à l'emplacement du curseur (comme le clavier, accents compris). */
  async type(text) {
    await this.send("Input.insertText", { text });
  }

  /** Touche le champ, remplace son contenu par `text`. */
  async fill(want, text, options = {}) {
    // Le formulaire peut encore bouger au moment du toucher : le focus est vérifié avant de saisir.
    const focused = () => this.eval(`
      const e = (${FINDER})(${JSON.stringify(want)}, ${JSON.stringify(options.within ?? null)}, ${options.nth ?? 0});
      const a = document.activeElement;
      return !!e && (a === e || e.contains(a) || e.control === a);`);
    for (let attempt = 0; ; attempt++) {
      await this.tap(want, options);
      if (await focused()) break;
      if (attempt === 2) throw new Error(`champ « ${want} » sans le focus après le toucher`);
    }
    await this.eval("const e = document.activeElement; if (e && 'select' in e) e.select(); return true;");
    await this.type(text);
  }

  /** Ferme le clavier (sans toucher à l'interface). */
  async blur() {
    await this.eval("document.activeElement?.blur(); return true;");
    await sleep(300);
  }

  text() {
    return this.eval("return document.body.innerText;");
  }

  async waitText(pattern, { timeout = 20000 } = {}) {
    const test = (t) => (typeof pattern === "string" ? t.includes(pattern) : pattern.test(t));
    return waitUntil(async () => test(await this.text()), { timeout, what: `texte ${pattern}` });
  }

  /** Commande Tauri, comme l'interface l'appelle. */
  invoke(cmd, args) {
    return this.eval(`return await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)});`);
  }
}

export function screenshot(file) {
  const png = execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(file, png);
}
