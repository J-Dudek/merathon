#!/usr/bin/env node
// Vérification des PR / MR quand l'application est fermée (Android, tâche WorkManager), contre le faux GitHub.
// Option activée dans les préférences, application en arrière-plan, vérification déclenchée (APK de debug) :
// notification d'un nouveau commit, pas de doublon, retrait une fois la PR consultée, tâche annulée avec l'option.
// Usage : node pr-watch.mjs [--apk chemin.apk] [--out dossier]  (APK de debug : la WebView est pilotée par CDP)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { App, CODE_PKG, PKG, adb, screenshot, sleep, waitUntil } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const WORK = resolve(process.env.E2E_WORK ?? join(HERE, ".work"));
const OUT = resolve(option("--out") ?? join(WORK, "out-pr-watch"));
const GITHUB_PORT = Number(process.env.E2E_GITHUB_PORT ?? 8765);
const GITHUB = `http://localhost:${GITHUB_PORT}`;
const env = { ...process.env, E2E_WORK: WORK };
const TAG = "merathon-pr-watch";

const children = [];
function startServer(script) {
  const log = openSync(join(WORK, `${script}.out`), "a");
  children.push(spawn("python3", [join(HERE, "fake", script)], { env, stdio: ["ignore", log, log] }));
}

const portOpen = (port) => new Promise((ok) => {
  const s = createConnection({ port, host: "127.0.0.1" }, () => {
    s.end();
    ok(true);
  });
  s.on("error", () => ok(false));
});

const onDevice = (...cmd) => adb("shell", "run-as", PKG, ...cmd);

/** État partagé de la vérification (pr_watch.rs), dans le dossier de configuration de l'application. */
function watchState() {
  const path = onDevice("find", ".", "-name", "pr-watch.json").split("\n")[0].trim();
  return path ? JSON.parse(onDevice("cat", path)) : null;
}

/** Tâche WorkManager de l'application dans JobScheduler (`namespace`, `id`), null si aucune n'est programmée. */
function job() {
  const dump = adb("shell", "dumpsys", "jobscheduler", PKG);
  // « JOB androidx.work.systemjobscheduler:u0a244/1: 512318a #…@fr.byj6n.merathon/androidx.work…SystemJobService »
  const m = dump.match(new RegExp(`^\\s*JOB (?:(\\S+):)?u\\d+a\\d+/(\\d+): .*@${PKG.replace(/\./g, "\\.")}/androidx\\.work\\.`, "m"));
  return m ? { namespace: m[1], id: m[2] } : null;
}

/**
 * Lance la vérification tout de suite et attend sa trace dans logcat. WorkManager refuse d'exécuter une tâche
 * périodique avant son heure (même par `cmd jobscheduler run -f`) : l'APK de debug a un déclencheur pour les tests.
 */
async function runJob() {
  if (!job()) throw new Error("aucune tâche programmée");
  const dir = onDevice("pwd");
  adb("logcat", "-c");
  adb("shell", "am", "broadcast", "-n", `${PKG}/${CODE_PKG}.PrWatchRunNow`, "--es", "dir", dir);
  return waitUntil(() => {
    const log = adb("logcat", "-d", "-s", "MerathonPrWatch:*");
    return /vérification faite|premier plan|vérification impossible/.test(log) && log;
  }, { timeout: 60000, what: "passage de la tâche" });
}

/** Titres des notifications de la tâche actuellement affichées. */
function notifications() {
  const dump = adb("shell", "dumpsys", "notification", "--noredact");
  const titles = [];
  for (const record of dump.split("NotificationRecord(").slice(1)) {
    if (!record.includes(`pkg=${PKG}`) || !record.includes(`tag=${TAG}`)) continue;
    const title = record.match(/android\.title=String \(([^)]*)\)/);
    titles.push(title ? title[1] : "?");
  }
  return titles;
}

let app;
let shot = 0;
const results = [];

async function step(name, fn) {
  const started = Date.now();
  process.stdout.write(`▶ ${name}… `);
  try {
    await fn();
    screenshot(join(OUT, `${String(++shot).padStart(2, "0")}-ok.png`));
    results.push({ name, ok: true });
    console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.log("ÉCHEC");
    try {
      screenshot(join(OUT, `${String(++shot).padStart(2, "0")}-echec.png`));
    } catch {
      // capture impossible : l'erreur d'origine compte davantage
    }
    results.push({ name, ok: false, error: String(e?.message ?? e) });
    throw e;
  }
}

async function menu(entry) {
  await app.tap("css:header button");
  await app.tap(entry, { within: "[role=dialog]" });
}

async function syncPreferences() {
  await menu("Préférences…");
  await app.tap("Synchronisation", { within: "[role=dialog]" });
}

async function main() {
  execFileSync(join(HERE, "fake", "make_repos.sh"), { env, stdio: "inherit" });
  mkdirSync(OUT, { recursive: true });
  startServer("fake_github.py");
  await waitUntil(() => portOpen(GITHUB_PORT), { what: "faux GitHub" });
  adb("reverse", `tcp:${GITHUB_PORT}`, `tcp:${GITHUB_PORT}`);

  const apk = option("--apk");
  if (apk) {
    try {
      adb("install", "-r", "-g", resolve(apk));
    } catch {
      adb("uninstall", PKG);
      adb("install", "-g", resolve(apk));
    }
  }
  adb("shell", "pm", "clear", PKG);
  // `pm clear` retire aussi les autorisations accordées à l'installation.
  adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS");

  await step("Lancement et compte GitHub Enterprise", async () => {
    app = await App.launch();
    if ((await app.text()).includes("Langue / Language")) await app.tap("Continuer");
    await app.waitText("Ouvre, crée ou clone un dépôt");
    await menu("Comptes");
    await app.tap("+ Ajouter");
    await app.tap("GitHub Enterprise");
    await app.fill("Adresse de l'instance GitHub Enterprise", GITHUB);
    await app.fill("Token d'accès personnel", "ghp_faux_token_e2e");
    await app.blur();
    await app.tap("Connecter");
    await app.waitText("camille · localhost");
  });

  await step("Désactivée par défaut : aucune tâche programmée", async () => {
    await syncPreferences();
    await app.waitText("Vérifier l'activité de mes PR / MR");
    if (await app.eval("return [...document.querySelectorAll('label')].find((l) => l.textContent.includes('activité de mes PR'))?.querySelector('input').checked")) {
      throw new Error("option cochée par défaut");
    }
    if (job()) throw new Error("tâche programmée sans l'option");
  });

  await step("Option activée : tâche programmée, liste de référence transmise", async () => {
    await app.tap("Vérifier l'activité de mes PR / MR", { within: "[role=dialog]" });
    await waitUntil(() => job(), { what: "tâche WorkManager programmée" });
    await app.tap("Synchroniser maintenant", { within: "[role=dialog]" });
    await waitUntil(() => {
      const snapshots = Object.values(watchState()?.snapshots ?? {});
      return snapshots.some((s) => s.data.assigned.some((pr) => pr.number === 9));
    }, { what: "liste « mes PR » transmise à la tâche" });
    if (watchState().settings?.minutes !== 30) throw new Error(`intervalle inattendu : ${JSON.stringify(watchState().settings)}`);
  });

  await step("Application au premier plan : la tâche ne fait rien", async () => {
    const log = await runJob();
    if (!log.includes("premier plan")) throw new Error(`trace inattendue :\n${log}`);
    if (notifications().length) throw new Error("notification au premier plan");
  });

  await step("Fermée : un commit sur une PR à relire est notifié", async () => {
    adb("shell", "input", "keyevent", "KEYCODE_HOME");
    await sleep(1500);
    await fetch(`${GITHUB}/__test/teammate-push`);
    const log = await runJob();
    if (!log.includes("1 notification")) throw new Error(`trace inattendue :\n${log}`);
    await waitUntil(() => notifications().includes("PR #9 · Ajoute le panier"), { what: "notification de la PR #9" });
    if (watchState().shown.length !== 1) throw new Error("notification non retenue pour être retirée");
  });

  await step("Sans nouveau changement : pas de deuxième notification", async () => {
    const log = await runJob();
    if (!log.includes("0 notification")) throw new Error(`trace inattendue :\n${log}`);
    if (notifications().length !== 1) throw new Error(`notifications : ${notifications().join(", ")}`);
  });

  await step("Processus arrêté : la tâche relance l'application sans interface", async () => {
    adb("shell", "am", "kill", PKG);
    await waitUntil(() => {
      try {
        return !adb("shell", "pidof", PKG);
      } catch {
        return true; // pidof échoue quand aucun processus ne correspond
      }
    }, { what: "processus arrêté" });
    await fetch(`${GITHUB}/__test/ci?pr=9&state=failure`);
    const log = await runJob();
    if (!log.includes("1 notification")) throw new Error(`trace inattendue :\n${log}`);
    await waitUntil(() => notifications().length === 2, { what: "deuxième notification de la PR #9 (CI en échec)" });
  });

  await step("À l'ouverture : pas de doublon dans l'application", async () => {
    app.close();
    app = await App.launch();
    await syncPreferences();
    await app.tap("Synchroniser maintenant", { within: "[role=dialog]" });
    await sleep(4000);
    // Un bandeau reprendrait le titre de la notification (« PR #9 · Ajoute le panier — Nouveaux commits — … »).
    if ((await app.text()).includes("PR #9 · Ajoute le panier")) throw new Error("changement déjà notifié signalé une deuxième fois");
    await app.tap("Fermer", { within: "[role=dialog]" });
  });

  await step("PR consultée : notification retirée", async () => {
    await menu("Comptes");
    await app.tap("Ajoute le panier");
    await app.waitText("Ajoute le panier #9");
    await waitUntil(() => notifications().length === 0, { what: "notification retirée" });
    if (watchState().shown.length) throw new Error("notification encore retenue");
  });

  await step("Option désactivée : tâche annulée", async () => {
    app.close();
    app = await App.launch();
    await syncPreferences();
    await app.tap("Vérifier l'activité de mes PR / MR", { within: "[role=dialog]" });
    await waitUntil(() => !job(), { what: "tâche annulée" });
    if (watchState().settings) throw new Error("réglages encore actifs");
  });
}

try {
  await main();
  console.log(`\n✔ ${results.length} étapes réussies`);
} catch (e) {
  console.error(`\n✘ ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  app?.close();
  for (const c of children) c.kill();
}
