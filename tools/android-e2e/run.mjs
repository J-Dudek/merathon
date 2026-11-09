#!/usr/bin/env node
// Parcours de bout en bout de Merathon sur Android, contre un faux GitHub Enterprise et un serveur git SSH locaux.
// Voir README.md. Usage : node run.mjs [--apk chemin.apk] [--keep-data] [--no-ssh] [--out dossier]
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { App, PKG, adb, screenshot, sleep, waitUntil } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const WORK = resolve(process.env.E2E_WORK ?? join(HERE, ".work"));
const OUT = resolve(option("--out") ?? join(WORK, "out"));
const GITHUB_PORT = Number(process.env.E2E_GITHUB_PORT ?? 8765);
const SSH_PORT = Number(process.env.E2E_SSH_PORT ?? 2222);
const PIN = "1234";
const GITHUB = `http://localhost:${GITHUB_PORT}`;
const REPOS = `/data/data/${PKG}/repos`;
const env = { ...process.env, E2E_WORK: WORK };

// ------------------------------------------------------------------ Serveurs et vérifications côté serveur

const children = [];
function startServer(script) {
  // Sortie dans un fichier : un serveur qui garderait la sortie du script bloquerait un `| tail` jusqu'à sa fin.
  const log = openSync(join(WORK, `${script}.out`), "a");
  const child = spawn("python3", [join(HERE, "fake", script)], { env, stdio: ["ignore", log, log] });
  children.push(child);
  return child;
}

const portOpen = (port) => new Promise((ok) => {
  const s = createConnection({ port, host: "127.0.0.1" }, () => {
    s.end();
    ok(true);
  });
  s.on("error", () => ok(false));
});

/** git dans un dépôt du faux serveur. */
const serverGit = (repo, ...a) =>
  execFileSync("git", ["-C", join(WORK, "srv", "atelier", `${repo}.git`), ...a], { encoding: "utf8", env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();

const serverState = async () => (await fetch(`${GITHUB}/__test/state`)).json();
const sshLog = () => {
  try {
    return readFileSync(join(WORK, "sshd.log"), "utf8");
  } catch {
    return "";
  }
};
const onDevice = (...cmd) => adb("shell", "run-as", PKG, ...cmd);

// ------------------------------------------------------------------ Déroulé

let app;
let shot = 0;
const results = [];

async function step(name, fn) {
  const started = Date.now();
  process.stdout.write(`▶ ${name}… `);
  try {
    await fn();
    const file = join(OUT, `${String(++shot).padStart(2, "0")}-ok.png`);
    screenshot(file);
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.log("ÉCHEC");
    const file = join(OUT, `${String(++shot).padStart(2, "0")}-echec.png`);
    try {
      screenshot(file);
      writeFileSync(join(OUT, "echec-texte.txt"), (await app?.text()) ?? "");
    } catch {
      // capture impossible : l'erreur d'origine compte davantage
    }
    results.push({ name, ok: false, error: String(e?.message ?? e) });
    throw e;
  }
}

/** Menu ☰ de la barre d'outils (un tiroir sur mobile), puis une entrée. */
async function menu(entry) {
  await app.tap("css:header button");
  await app.tap(entry, { within: "[role=dialog]" });
}

const leftTab = (name) => app.tap(name, { within: "[aria-label='Contenu du panneau de gauche']" });
const bottomNav = (name) => app.tap(name, { within: "nav" });

async function main() {
  // make_repos.sh recrée tout le dossier de travail : les captures viennent après.
  execFileSync(join(HERE, "fake", "make_repos.sh"), { env, stdio: "inherit" });
  mkdirSync(OUT, { recursive: true });

  const ssh = !flag("--no-ssh");
  startServer("fake_github.py");
  if (ssh) startServer("fake_sshd.py");
  await waitUntil(() => portOpen(GITHUB_PORT), { what: "faux GitHub" });
  if (ssh) await waitUntil(() => portOpen(SSH_PORT), { what: "serveur SSH (pip install paramiko ?)" });

  adb("reverse", `tcp:${GITHUB_PORT}`, `tcp:${GITHUB_PORT}`);
  // Le SSH de Merathon vise le port 22 : celui de l'émulateur renvoie vers le serveur local.
  if (ssh) {
    try {
      adb("reverse", "tcp:22", `tcp:${SSH_PORT}`);
    } catch {
      // Avant Android 16 (API 36), un port < 1024 demande adbd en root (images google_apis, comme en CI).
      // Redémarrer adbd perd les redirections : elles sont refaites.
      adb("root");
      adb("wait-for-device");
      adb("reverse", `tcp:${GITHUB_PORT}`, `tcp:${GITHUB_PORT}`);
      adb("reverse", "tcp:22", `tcp:${SSH_PORT}`);
    }
  }

  const apk = option("--apk");
  if (apk) {
    try {
      adb("install", "-r", "-g", resolve(apk));
    } catch {
      // Signature différente (APK de release déjà installé) : désinstaller d'abord.
      adb("uninstall", PKG);
      adb("install", "-g", resolve(apk));
    }
  }
  if (!flag("--keep-data")) adb("shell", "pm", "clear", PKG);

  await step("Lancement et choix de la langue", async () => {
    app = await App.launch();
    if ((await app.text()).includes("Langue / Language")) await app.tap("Continuer");
    await app.waitText("Ouvre, crée ou clone un dépôt");
  });

  await step("Identité Git", async () => {
    await menu("Comptes");
    await app.fill("Nom de l'identité Git", "Camille Martin");
    await app.fill("E-mail de l'identité Git", "camille@example.com");
    await app.tap("Enregistrer");
    await app.waitText("Camille Martin <camille@example.com>");
  });

  await step("Compte GitHub Enterprise (faux serveur) ajouté depuis l'interface", async () => {
    // Le tiroir des comptes se referme parfois pendant la saisie (vu en CI, cause inconnue) : il est rouvert et
    // le formulaire repris, au lieu d'attendre en vain un champ qui n'est plus affiché.
    for (let attempt = 1; ; attempt++) {
      try {
        if (!(await app.locate("+ Ajouter")) && !(await app.locate("GitHub Enterprise"))) await menu("Comptes");
        if (await app.locate("+ Ajouter")) await app.tap("+ Ajouter");
        await app.tap("GitHub Enterprise", { timeout: 5000 });
        await app.fill("Adresse de l'instance GitHub Enterprise", GITHUB, { timeout: 5000 });
        await app.fill("Token d'accès personnel", "ghp_faux_token_e2e", { timeout: 5000 });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        process.stdout.write(`(formulaire disparu, essai ${attempt + 1}) `);
      }
    }
    await app.blur();
    await app.tap("Connecter");
    await app.waitText("camille · localhost");
  });

  await step("Clone HTTPS avec le token du compte", async () => {
    await menu("Cloner…");
    await app.fill("^https://github.com/owner", `${GITHUB}/atelier/site-vitrine.git`, { within: "[role=dialog]" });
    await app.blur();
    await app.tap("Cloner", { within: "[role=dialog]" });
    await app.waitText(`Dépôt cloné dans ${REPOS}/site-vitrine`, { timeout: 60000 });
    await app.waitText("Documente le lancement");
  });

  await step("Modification d'un fichier dans l'application", async () => {
    await menu("Fichiers du dépôt…");
    await app.tap("README.md", { within: "[role=dialog]" });
    await app.tap("Contenu de README.md");
    await app.eval("const t = document.activeElement; t.setSelectionRange(t.value.length, t.value.length); return true;");
    await app.type("\nModifié sur Android, sans autre éditeur.\n");
    await app.blur();
    await app.tap("Enregistrer", { within: "[role=dialog]" });
    await app.waitText("README.md enregistré");
    await app.tap("Fermer", { within: "[role=dialog]" });
    const content = onDevice("cat", `${REPOS}/site-vitrine/README.md`);
    if (!content.includes("Modifié sur Android")) throw new Error(`README.md inchangé sur l'appareil :\n${content}`);
  });

  await step("Commit et push", async () => {
    await bottomNav("Détails");
    await app.tap("Tout indexer");
    await app.fill("Résumé du commit", "Précise le README depuis le téléphone");
    await app.blur();
    await app.tap("^Commiter 1");
    await app.waitText("Aucune modification en cours");
    await app.tap("Push");
    await waitUntil(() => serverGit("site-vitrine", "log", "-1", "--format=%s %ae", "main") === "Précise le README depuis le téléphone camille@example.com",
      { timeout: 30000, what: "commit sur le serveur" });
    if (!serverGit("site-vitrine", "show", "main:README.md").includes("Modifié sur Android")) throw new Error("contenu absent du serveur");
  });

  await step("Fetch : commit d'un coéquipier", async () => {
    await fetch(`${GITHUB}/__test/teammate-push`);
    await app.tap("Fetch");
    await bottomNav("Historique");
    await app.waitText("Ajoute le total du panier");
  });

  await step("Pull request : approbation", async () => {
    await bottomNav("Dépôt");
    await leftTab("Dépôt");
    await app.tap("Ajoute le panier", { within: "aside" });
    await app.waitText("Ajoute le panier #9");
    await app.tap("Approuver", { within: "[role=dialog]" });
    await waitUntil(async () => (await serverState())["site-vitrine"]["9"].reviews.includes("APPROVED:camille"), { what: "approbation sur le serveur" });
    await app.tap("Fermer", { within: "[role=dialog]" });
  });

  await step("Menu d'une branche par le bouton ⋮", async () => {
    await leftTab("Dépôt");
    await app.tap("Actions sur main", { within: "aside" });
    await app.waitText("Copier le nom");
    await back();
    await waitUntil(async () => !(await app.text()).includes("Copier le nom"), { what: "menu fermé par Retour" });
  });

  await step("Retour d'Android : diff plein écran, puis PR, puis fermé", async () => {
    await app.tap("Ajoute le panier", { within: "aside" });
    await app.tap("Fichiers modifiés", { within: "[role=dialog]" });
    await app.tap("panier.js", { within: "[role=dialog]" });
    await waitUntil(async () => (await dialogTitles()).join() === "Ajoute le panier #9,panier.js", { what: "diff ouvert sur la PR" });
    await back();
    await waitUntil(async () => (await dialogTitles()).join() === "Ajoute le panier #9", { what: "Retour : diff fermé, PR ouverte" });
    await back();
    await waitUntil(async () => (await dialogTitles()).length === 0, { what: "Retour : PR fermée" });
  });

  await step("Retour d'Android depuis le diff d'un commit : liste de ses fichiers", async () => {
    const currentScreen = () => app.eval(`return [...document.querySelectorAll("nav [aria-current=page]")].map((e) => e.textContent).join(" ");`);
    await bottomNav("Historique");
    await app.tap("Précise le README depuis le téléphone");
    await waitUntil(async () => (await currentScreen()).includes("Détails"), { what: "détail du commit" });
    await app.tap("README.md");
    await waitUntil(async () => (await currentScreen()).includes("Historique"), { what: "diff du fichier" });
    await back();
    await waitUntil(async () => (await currentScreen()).includes("Détails"), { what: "Retour : détail du commit, pas le graphe" });
    await app.waitText("README.md");
    await bottomNav("Historique");
  });

  await step("Retour d'Android dans l'éditeur : fichier, puis liste, puis fermé", async () => {
    await menu("Fichiers du dépôt…");
    await app.tap("index.html", { within: "[role=dialog]" });
    await app.waitText("Enregistré");
    await back();
    await waitUntil(async () => (await dialogTitles()).join() === "Fichiers du dépôt", { what: "Retour : liste des fichiers" });
    await back();
    await waitUntil(async () => (await dialogTitles()).length === 0, { what: "Retour : éditeur fermé" });
  });

  await step("Mémo Git : ouvert sans clavier, avec les équivalents tactiles", async () => {
    await menu("Mémo Git");
    await app.waitText("deviennent un appui long");
    const focused = await app.eval("return document.activeElement?.tagName ?? null;");
    if (focused === "INPUT" || focused === "TEXTAREA") throw new Error("un champ a le focus : le clavier s'ouvre");
    await back();
  });

  await step("Tablette : les trois colonnes du bureau, diff d'une PR à côté de la liste des fichiers", async () => {
    const columns = () => app.eval(`
      const visible = (e) => !!e && e.getBoundingClientRect().width > 0;
      return [...document.querySelectorAll("aside, main")].filter(visible).length;`);
    const bottomBar = () => app.eval(`return !!document.querySelector("nav[aria-label=\\"Écrans de l'application\\"]");`);
    try {
      // Paysage puis portrait (plus petit côté de 800 px CSS, au-delà du seuil de 600 des tablettes Android).
      for (const [size, name] of [["2560x1600", "paysage"], ["1600x2560", "portrait"]]) {
        adb("shell", "wm", "size", size);
        adb("shell", "wm", "density", "320");
        app.close();
        app = await App.launch();
        await waitUntil(() => app.eval("return Math.min(screen.width, screen.height) >= 600;"), { what: "écran de tablette" });
        // Relancée, l'application rouvre sur l'accueil : le dépôt se rouvre depuis les récents.
        await app.tap("site-vitrine");
        await waitUntil(async () => (await columns()) === 3, { what: `trois colonnes en ${name}` });
        if (await bottomBar()) throw new Error(`barre de navigation du téléphone affichée en ${name}`);
        const center = await app.eval(`return Math.round(document.querySelector("main").getBoundingClientRect().width);`);
        if (center < 320) throw new Error(`zone centrale trop étroite en ${name} : ${center} px`);
        await app.waitText("Précise le README depuis le téléphone");
        screenshot(join(OUT, `tablette-${name}.png`));
      }
      await leftTab("Dépôt");
      await app.tap("Ajoute le panier", { within: "aside[aria-label^='Dépôt']" });
      await app.tap("Fichiers modifiés", { within: "[role=dialog]" });
      await app.tap("panier.js", { within: "[role=dialog]" });
      await waitUntil(() => app.eval(`return [...document.querySelectorAll("[role=dialog] th")].some((th) => th.textContent === "Ancienne ligne");`), { what: "diff du bureau (colonnes ancienne / nouvelle ligne)" });
      const titles = await dialogTitles();
      if (titles.join() !== "Ajoute le panier #9") throw new Error(`fenêtres ouvertes : ${titles.join(" / ")} (diff en plein écran ?)`);
      // Pas de survol au doigt : le bouton de commentaire de ligne reste visible.
      const opacity = await app.eval(`const b = document.querySelector("[role=dialog] button[aria-label^='Commenter la ligne']"); return b ? Number(getComputedStyle(b).opacity) : null;`);
      if (!(opacity > 0)) throw new Error(`bouton de commentaire de ligne invisible (opacité ${opacity})`);
      screenshot(join(OUT, "tablette-diff-pr.png"));
      await back();
      // Retour d'Android sans panneaux : la PR fermée, l'application reste ouverte.
      await waitUntil(async () => (await dialogTitles()).length === 0, { what: "Retour : PR fermée" });
    } finally {
      adb("shell", "wm", "size", "reset");
      adb("shell", "wm", "density", "reset");
      app.close();
      app = await App.launch();
    }
  });

  if (ssh) await sshSteps();
}

/** Titres des fenêtres ouvertes, de la plus ancienne à celle du dessus. */
const dialogTitles = () => app.eval(`return [...document.querySelectorAll("[role=dialog] h2")].map((h) => h.textContent);`);

/** Bouton Retour d'Android. */
async function back() {
  adb("shell", "input", "keyevent", "BACK");
  await sleep(600);
}

/** SSH avec la clé de l'appareil : réglage expérimental, clé du Keystore, confirmation par le code de l'appareil. */
async function sshSteps() {
  if (adb("shell", "locksettings", "get-disabled") !== "true") {
    console.log("⚠ l'appareil a déjà un verrouillage d'écran : étapes SSH ignorées");
    return;
  }
  adb("shell", "locksettings", "set-pin", PIN);
  try {
    await step("SSH : réglage expérimental", async () => {
      await menu("Préférences…");
      await app.tap("SSH", { within: "[role=dialog]" });
      await app.tap("css:input[type=checkbox]", { within: "[role=dialog]" });
      await app.waitText("Aucune clé pour l'instant");
      await app.tap("Fermer", { within: "[role=dialog]" });
    });

    await step("SSH : clé du Keystore, empreinte de l'hôte, confirmation par code", async () => {
      await bottomNav("Dépôt");
      await leftTab("Comptes");
      await app.tap("^Options du compte");
      await app.tap("Configurer SSH…");
      await app.tap("Configurer", { within: "[role=dialog]" });
      await app.waitText("Compare celle-ci à celle donnée", { timeout: 30000 });
      const shown = (await app.text()).match(/SHA256:[A-Za-z0-9+/]+/g) ?? [];
      const server = sshLog().match(/hôte \S+ (SHA256:\S+)/)?.[1];
      if (!server || !shown.includes(server)) throw new Error(`empreinte affichée ${shown} ≠ serveur ${server}`);
      await app.tap("L'empreinte est correcte");
      await enterPin();
      await app.waitText("Clé acceptée par localhost", { timeout: 30000 });
      if (!/auth git ecdsa-sha2-nistp256 \S+ -> OK/.test(sshLog())) throw new Error("aucune authentification ECDSA côté serveur");
      await app.tap("Fermer", { within: "[role=dialog]" });
    });

    await step("SSH : clone sans nouvelle confirmation (moins de 30 s)", async () => {
      await menu("Cloner…");
      await app.fill("^https://github.com/owner", "git@localhost:atelier/boutique-api.git", { within: "[role=dialog]" });
      await app.blur();
      await app.tap("Cloner", { within: "[role=dialog]" });
      await app.waitText(`Dépôt cloné dans ${REPOS}/boutique-api`, { timeout: 60000 });
      if (!sshLog().includes("exec git-upload-pack 'atelier/boutique-api.git'")) throw new Error("clone absent du journal SSH");
    });

    await step("SSH : aucune clé privée dans les fichiers de l'application", async () => {
      const files = onDevice("ls", "-a", `/data/data/${PKG}/.ssh`).split(/\s+/).filter((f) => f && f !== "." && f !== "..");
      if (files.join(",") !== "known_hosts") throw new Error(`.ssh contient : ${files.join(", ")}`);
    });
  } finally {
    adb("shell", "locksettings", "clear", "--old", PIN);
  }
}

/** La demande de code est une fenêtre sécurisée du système (pas de capture) : on la remplit au clavier. */
async function enterPin() {
  await sleep(2500);
  adb("shell", "input", "text", PIN);
  adb("shell", "input", "keyevent", "ENTER");
}

function cleanup() {
  app?.close();
  for (const c of children) c.kill();
  try {
    adb("reverse", "--remove-all");
  } catch {
    // appareil déconnecté
  }
}

main()
  .then(() => {
    console.log(`\n✔ ${results.length} étapes réussies. Captures : ${OUT}`);
  })
  .catch((e) => {
    console.error(`\n✘ ${e?.message ?? e}\nCaptures et texte de l'écran : ${OUT}`);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
    try {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "resultats.json"), JSON.stringify(results, null, 2));
    } catch (e) {
      console.error(`résultats non écrits : ${e.message}`);
    }
  });
