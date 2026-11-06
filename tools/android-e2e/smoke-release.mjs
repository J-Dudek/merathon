#!/usr/bin/env node
// Vérification rapide d'un APK de RELEASE (R8, Rust optimisé), où la WebView n'est pas pilotable en DevTools :
// l'interface est lue dans l'arbre d'accessibilité d'Android (uiautomator) et pilotée par de vrais gestes.
// Usage : node smoke-release.mjs --apk app-release.apk   (efface les données de l'application, comme run.mjs)
import { execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVITY, PKG, adb, sleep, waitUntil } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const apk = args.includes("--apk") ? resolve(args[args.indexOf("--apk") + 1]) : null;
const WORK = resolve(process.env.E2E_WORK ?? join(HERE, ".work"));
const PORT = Number(process.env.E2E_GITHUB_PORT ?? 8765);
const env = { ...process.env, E2E_WORK: WORK };

/** Nœuds visibles de l'écran : texte ou description, et centre en pixels. */
function screen() {
  adb("shell", "uiautomator", "dump", "/sdcard/merathon-ui.xml");
  const xml = adb("shell", "cat", "/sdcard/merathon-ui.xml");
  const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const attr = (name) => unescape(n.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? "");
    const [x1, y1, x2, y2] = attr("bounds").match(/\d+/g).map(Number);
    // Un champ de saisie porte son libellé dans `hint` (aria-label), son contenu dans `text`.
    const labels = [attr("text"), attr("content-desc"), attr("hint")].filter(Boolean);
    return { labels, cls: attr("class"), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1, w: x2 - x1, h: y2 - y1 };
  }).filter((n) => n.labels.length && n.w > 0 && n.h > 0);
}

const matches = (n, want) => n.labels.some((l) => (want instanceof RegExp ? want.test(l) : l === want));
const find = (nodes, want) => nodes.findLast((n) => matches(n, want));

async function waitFor(want, timeout = 20000) {
  return waitUntil(() => find(screen(), want), { timeout, interval: 500, what: `« ${want} » à l'écran` });
}

async function tap(want, { clickable = false } = {}) {
  const node = await waitUntil(() => {
    const nodes = screen();
    return clickable ? nodes.findLast((n) => n.cls.endsWith("Button") && matches(n, want)) : find(nodes, want);
  }, { timeout: 15000, interval: 500, what: `« ${want} »` });
  adb("shell", "input", "tap", String(node.x), String(node.y));
  await sleep(700);
}

/** Saisie au clavier de l'appareil (ASCII sans espace), vérifiée : le formulaire peut encore bouger au moment du toucher. */
async function typeInto(want, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await tap(want);
    adb("shell", "input", "text", text);
    await sleep(400);
    const field = find(screen(), want);
    // Un champ masqué (token) n'expose que des points : sa longueur suffit.
    if (field && field.labels.some((l) => l.includes(text) || (/^•+$/.test(l) && l.length >= text.length))) return;
  }
  throw new Error(`saisie impossible dans « ${want} »`);
}

/** Ferme le clavier s'il est affiché (Retour, sinon, reviendrait à l'écran précédent). */
async function hideKeyboard() {
  if (/mInputShown=true/.test(adb("shell", "dumpsys", "input_method"))) {
    adb("shell", "input", "keyevent", "BACK");
    await sleep(500);
  }
}

const portOpen = (port) => new Promise((ok) => {
  const s = createConnection({ port, host: "127.0.0.1" }, () => {
    s.end();
    ok(true);
  });
  s.on("error", () => ok(false));
});

let server;
const steps = [];
async function step(name, fn) {
  process.stdout.write(`▶ ${name}… `);
  await fn();
  steps.push(name);
  console.log("ok");
}

async function main() {
  execFileSync(join(HERE, "fake", "make_repos.sh"), { env, stdio: "ignore" });
  const log = openSync(join(WORK, "fake_github.py.out"), "a");
  server = spawn("python3", [join(HERE, "fake", "fake_github.py")], { env, stdio: ["ignore", log, log] });
  await waitUntil(() => portOpen(PORT), { what: "faux GitHub" });
  adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);

  if (apk) {
    try {
      adb("install", "-r", apk);
    } catch {
      // Signature différente (APK de debug déjà installé) : désinstaller d'abord.
      adb("uninstall", PKG);
      adb("install", apk);
    }
  }
  adb("shell", "pm", "clear", PKG);
  adb("logcat", "-c");

  await step("Lancement (release)", async () => {
    adb("shell", "am", "start", "-n", ACTIVITY);
    await waitFor("Langue / Language", 30000);
    await tap("Continuer");
    await waitFor(/Ouvre, crée ou clone un dépôt/);
  });

  await step("Compte GitHub Enterprise", async () => {
    await tap(/^Ouvrir le menu/, { clickable: true });
    await tap("Comptes");
    await tap("+ Ajouter");
    await tap("GitHub Enterprise");
    await typeInto("Adresse de l'instance GitHub Enterprise", `http://localhost:${PORT}`);
    await typeInto("Token d'accès personnel", "ghp_faux_token_release");
    await hideKeyboard();
    await tap("Connecter");
    await waitFor(/camille · localhost/);
  });

  await step("Clone HTTPS (libgit2 compilé en release)", async () => {
    await tap(/^Ouvrir le menu/, { clickable: true });
    await tap("Cloner…");
    adb("shell", "input", "text", `http://localhost:${PORT}/atelier/site-vitrine.git`);
    await hideKeyboard();
    await tap("Cloner", { clickable: true });
    await waitFor(/Dépôt cloné dans/, 60000);
    await waitFor("Documente le lancement");
  });

  await step("Pont JNI vers le Keystore (préservé par R8)", async () => {
    await tap(/^Ouvrir le menu/, { clickable: true });
    await tap("Préférences…");
    await tap("SSH");
    // Réponse de MerathonKeystore.state() : sans verrouillage d'écran, ou sans clé.
    await waitFor(/Configure d'abord un verrouillage d'écran|Aucune clé pour l'instant/);
  });

  await step("Vérification des PR en arrière-plan : WorkManager et pont JNI (préservés par R8)", async () => {
    const scheduled = () => new RegExp(`JOB \\S*u\\d+a\\d+/\\d+: .*@${PKG.replace(/\./g, "\\.")}/androidx\\.work\\.`).test(adb("shell", "dumpsys", "jobscheduler", PKG));
    await hideKeyboard();
    await tap("Synchronisation");
    await tap("Vérifier l'activité de mes PR / MR");
    // Programmée par Rust (JNI → MerathonPrWatch.schedule) ; WorkManager fait un premier passage aussitôt, qui
    // s'arrête là puisque l'application est au premier plan.
    await waitUntil(scheduled, { what: "tâche programmée" });
    await waitUntil(() => adb("logcat", "-d", "-s", "MerathonPrWatch:*").includes("premier plan"), { what: "premier passage de la tâche" });
    // Cocher l'option demande l'autorisation des notifications (Android 13+) : acceptée, comme le ferait l'utilisateur.
    await tap(/^(Allow|Autoriser)$/, { clickable: true });
    await tap("Vérifier l'activité de mes PR / MR");
    await waitUntil(() => !scheduled(), { what: "tâche annulée" });
  });

  await step("Aucun plantage dans le journal", async () => {
    const crashes = adb("logcat", "-d", "-s", "AndroidRuntime:E", "DEBUG:F").split("\n").filter((l) => /FATAL|crash|backtrace|NoSuchMethod|ClassNotFound/i.test(l));
    if (crashes.length) throw new Error(crashes.slice(0, 5).join("\n"));
  });
}

main()
  .then(() => console.log(`\n✔ ${steps.length} étapes réussies (release)`))
  .catch((e) => {
    console.error(`\n✘ ${e?.message ?? e}`);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.kill();
    try {
      adb("reverse", "--remove-all");
    } catch {
      // appareil déconnecté
    }
  });
