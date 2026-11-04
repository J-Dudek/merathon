// Enregistre la démo anglaise : images PNG + délais, assemblées ensuite par encode.cjs (voir README.md).
const fs = require("fs"), http = require("http"), path = require("path");
const { chromium } = require("playwright");

const SRC = path.resolve(__dirname, "../../git-client/src/i18n/en.ts");
const en = new Function(fs.readFileSync(SRC, "utf8").replace(/export const en[^=]*=/, "return") )();
const t = (fr, params = {}) => {
  if (!(fr in en)) throw new Error(`no translation: ${fr}`);
  return en[fr].replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
};

const OUT = path.join(__dirname, "frames");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

const PORT = 5273;
const DIST = path.join(__dirname, "dist");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".svg": "image/svg+xml" };
if (!fs.existsSync(path.join(DIST, "index.html"))) throw new Error("dist/ manquant : lancer d'abord npm run build");

/** Sert le frontend compilé, sur la boucle locale uniquement. */
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(DIST, url === "/" ? "index.html" : url);
  if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 / 3, locale: "en-US", colorScheme: "dark", permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript({ path: path.join(__dirname, "mock.js") });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on("console", (m) => { if (["warning", "error"].includes(m.type())) console.log(`[${m.type()}]`, m.text().slice(0, 220)); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "demo-cursor";
    d.style.cssText = "position:fixed;left:0;top:0;z-index:99999;pointer-events:none;width:22px;height:22px;transform:translate(700px,450px)";
    d.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 11.5-6.6.9 3.9 7.3-3 1.6-3.9-7.4L5 20z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(d);
    window.__cursor = (x, y) => { d.style.transform = `translate(${x}px,${y}px)`; };
  });

  let n = 0, x = 700, y = 450, recording = true;
  const delays = [];
  async function hold(ms) {
    if (!recording) return page.waitForTimeout(Math.min(ms, 150));
    const file = path.join(OUT, `${String(n++).padStart(5, "0")}.png`);
    await page.screenshot({ path: file, animations: "allow", caret: "initial" });
    delays.push(ms);
  }
  async function moveTo(tx, ty) {
    const steps = recording ? 4 : 1;
    const fx = x, fy = y;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k * (2 - k);
      const px = fx + (tx - fx) * e, py = fy + (ty - fy) * e;
      await page.mouse.move(px, py);
      await page.evaluate(([a, b]) => window.__cursor(a, b), [px, py]);
      if (i < steps) await hold(50);
    }
    x = tx; y = ty;
    await page.waitForTimeout(50);
    await hold(160);
  }
  async function center(locator) {
    await locator.waitFor({ state: "visible" });
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    return [b.x + Math.min(b.width / 2, 120), b.y + b.height / 2];
  }
  const hover = async (locator) => moveTo(...(await center(locator)));
  async function click(locator, opts = {}) {
    const [cx, cy] = await center(locator);
    await moveTo(cx, cy);
    if (opts.modifiers) for (const m of opts.modifiers) await page.keyboard.down(m);
    await page.mouse.click(cx, cy, { button: opts.button ?? "left" });
    if (opts.modifiers) for (const m of opts.modifiers) await page.keyboard.up(m);
    await page.waitForTimeout(opts.wait ?? 180);
    await hold(opts.hold ?? 300);
  }
  const rightClick = (locator, opts = {}) => click(locator, { ...opts, button: "right" });
  async function typeText(text, per = 4) {
    for (let i = 0; i < text.length; i += per) {
      await page.keyboard.type(text.slice(i, i + per));
      await hold(90);
    }
    await page.waitForTimeout(120);
  }
  async function press(key, ms = 400) {
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
    await hold(ms);
  }
  const text = (s, opts = {}) => page.getByText(s, { exact: true, ...opts }).first();
  const button = (s, exact = true) => page.getByRole("button", { name: s, exact }).first();
  const history = () => page.getByLabel(t("Historique des commits"));
  const row = (s) => history().getByText(s, { exact: true }).first();
  const menuItem = (s) => page.getByRole("menuitem", { name: s }).first();
  const syncNow = () => page.getByRole("button", { name: t("Synchroniser les dépôts ouverts") }).first();
  const tab = (s) => page.getByRole("navigation", { name: t("Dépôts ouverts") }).getByRole("button", { name: new RegExp(`^${s}`) }).first();
  const quiet = async (fn) => { const r = recording; recording = false; try { await fn(); } finally { recording = r; } };

  const scenes = {
    async graph() {
      await hold(1400);
      await moveTo(286, 118); await page.waitForTimeout(250); await hold(1100);
      await moveTo(310, 146); await page.waitForTimeout(250); await hold(1100);
      await click(row("Contact form: add the fields"), { hold: 1200 });
      await click(page.getByText("src/contact/Form.tsx").first(), { hold: 1800 });
      await press("Escape", 500);
    },
    async tabs() {
      await click(tab("online-shop"), { wait: 500, hold: 1400 });
      await click(tab("showcase-site"), { wait: 500, hold: 900 });
    },
    async solo() {
      await rightClick(history().locator('[title="feature/gallery"]').first(), { hold: 1500 });
      await click(menuItem(t("Solo : n'afficher que cette branche")), { wait: 400, hold: 1500 });
      await click(button(t("Tout afficher")), { wait: 300, hold: 700 });
    },
    async compare() {
      await click(row("Newsletter: welcome email template"), { hold: 500 });
      await click(row("Pricing: monthly and yearly toggle"), { modifiers: ["Control"], hold: 500 });
      await rightClick(row("Pricing: monthly and yearly toggle"), { hold: 1100 });
      await click(menuItem(t("Comparer les 2 commits")), { wait: 300, hold: 1800 });
    },
    async branchActions() {
      await click(row("Mobile: fix the menu not opening"), { hold: 400 });
      await rightClick(row("Update the build dependencies"), { hold: 2200 });
      await press("Escape", 300);
    },
    async pullRequest() {
      await click(page.getByText("Contact form with validation").first(), { wait: 600, hold: 2600 });
      await click(button(t("Fichiers modifiés")), { wait: 500, hold: 1000 });
      await click(page.getByText("validate.ts").first(), { wait: 300, hold: 900 });
      const line = page.getByRole("button", { name: /Comment on line added 12/ }).first();
      await line.locator("xpath=ancestor::tr").first().hover();
      const [lx, ly] = await center(line);
      await moveTo(lx, ly); await hold(500);
      await page.mouse.click(lx, ly); await page.waitForTimeout(200); await hold(400);
      await typeText("Should we allow a plus sign in the address?");
      await hold(400);
      await click(button(t("Ajouter à la revue")), { hold: 900 });
      await click(button(t("Terminer la revue ({length})", { length: 1 })), { hold: 900 });
      await click(page.getByLabel(t("Approuver"), { exact: true }).first(), { hold: 500 });
      await click(page.locator("textarea:visible").first(), { hold: 200 });
      await typeText("Looks good, thanks!");
      await hold(500);
      await click(button(t("Publier la revue")), { wait: 500, hold: 1800 });
      await press("Escape", 600);
      await quiet(async () => {
        await page.evaluate(() => window.__demo.ageSnapshot());
        await syncNow().click();
        await page.getByText("Contact form with validation — Approved").first().waitFor({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        for (const b of await page.getByRole("button", { name: "Close notification" }).all()) await b.click().catch(() => {});
        await page.waitForTimeout(200);
      });
    },
    async sync() {
      await hover(syncNow());
      await page.evaluate(() => { window.__demo.ageSnapshot(); window.__demo.applySync(); });
      await click(syncNow(), { wait: 1000, hold: 3600 });
      await hover(tab("online-shop")); await page.waitForTimeout(600); await hold(1500);
      await click(tab("online-shop"), { wait: 600, hold: 900 });
      await click(page.getByRole("complementary").first().getByText("Product pagination").first(), { wait: 500, hold: 1600 });
      await press("Escape", 900);
      await click(tab("showcase-site"), { wait: 500, hold: 700 });
    },
    async worktree() {
      await click(page.getByRole("button", { name: /^Worktrees/ }).first(), { hold: 500 });
      await click(page.getByTitle(t("Nouveau worktree")).first(), { hold: 500 });
      await typeText("new-hero");
      await hold(300);
      await press("Enter", 700);
      await hold(500);
      await press("Enter", 300);
      await page.waitForTimeout(700);
      await hold(1700);
      await click(tab("showcase-site"), { wait: 500, hold: 700 });
      await rightClick(page.getByRole("complementary").getByText("new-hero", { exact: true }).first(), { hold: 1900 });
      await press("Escape", 200);
      await click(page.getByRole("button", { name: /^Worktrees/ }).first(), { hold: 500 });
      await rightClick(page.getByRole("complementary").first().locator('[title="/home/camille/projects/showcase-site-new-hero"]').first(), { hold: 900 });
      await click(page.getByRole("menuitem", { name: /Delete|Remove/ }).last(), { hold: 1200 });
      await click(page.getByRole("dialog").getByRole("button").last(), { wait: 600, hold: 900 });
    },
    async preferences() {
      await page.keyboard.press("Control+,"); await page.waitForTimeout(300); await hold(600);
      await click(button(t("Synchronisation")), { hold: 2600 });
      await press("Escape", 400);
    },
    async createPr() {
      await rightClick(page.getByRole("complementary").getByText("newsletter", { exact: true }).first(), { hold: 900 });
      await click(menuItem(t("Créer une {noun} {forge}…", { noun: t("pull request"), forge: "GitHub" })), { wait: 500, hold: 1000 });
      await click(page.getByLabel(t("Titre"), { exact: true }).first());
      await page.keyboard.press("Control+a");
      await typeText("Add the newsletter sign-up", 3);
      const area = page.locator("textarea:visible").first();
      await click(area, { hold: 300 });
      await area.evaluate((el) => { const s = el.value.indexOf("<!--"), e = el.value.indexOf("-->") + 3; el.setSelectionRange(s, e); });
      await hold(600);
      await typeText("Adds the sign-up block to the footer.\n\n#");
      await page.waitForTimeout(500); await hold(1000);
      await typeText("foot", 1);
      await page.waitForTimeout(200); await hold(1000);
      await page.keyboard.press("Shift+Enter"); await page.waitForTimeout(200); await hold(1400);
      const reviewers = page.getByLabel(t("Relecteurs")).first();
      await click(reviewers, { hold: 300 });
      await typeText("lea", 1);
      await page.waitForTimeout(250); await hold(700);
      await press("Enter", 700);
      const create = button(t("Créer la {noun}", { noun: t("pull request") }));
      await click(create, { wait: 800, hold: 1800 });
    },
    async accounts() {
      await click(button(t("Comptes")), { wait: 800, hold: 2600 });
    },
    async ssh() {
      await rightClick(page.getByRole("complementary").getByText("Camille Atelier").first(), { hold: 900 });
      await click(menuItem(t("Configurer SSH…")), { wait: 400, hold: 2000 });
      await click(button(t("Configurer")), { wait: 1200, hold: 3200 });
            await click(button(t("Fermer"), true).last(), { hold: 500 });
    },
    async profile() {
      await page.keyboard.press("Control+,"); await page.waitForTimeout(300); await hold(400);
      await click(button(t("Profils Git")), { hold: 800 });
      await click(button(t("Nouveau profil")), { hold: 800 });
      await click(page.getByPlaceholder(t("GitLab pro")));
      await typeText("Atelier", 2);
      await click(page.getByPlaceholder(t("/home/moi/dev/pro")));
      await typeText("/home/camille/projects", 5);
      const name = page.getByLabel(t("Nom dans les commits")).first();
      await click(name); await typeText("Camille Martin", 4);
      await click(page.getByLabel(t("E-mail dans les commits")).first()); await typeText("camille@atelier.example", 6);
      await page.getByLabel(t("Compte associé")).first().selectOption({ index: 1 }); await page.waitForTimeout(200); await hold(800);
      await page.locator("label", { hasText: t("Clé SSH") }).locator("select").first().selectOption({ index: 1 }); await page.waitForTimeout(200); await hold(1000);
      await click(button(t("Enregistrer")), { wait: 500, hold: 1700 });
      await press("Escape", 700);
    },
    async identity() {
      await click(button(t("Dépôt")), { wait: 400, hold: 700 });
      await moveTo(1422, 90); await page.mouse.click(1422, 90); await page.keyboard.press("F5"); await page.waitForTimeout(500); await hold(300);
      await hold(2100);
      await click(button(t("Utiliser le profil")), { wait: 300, hold: 1700 });
      await click(page.getByRole("dialog").getByRole("button").last(), { wait: 500, hold: 1400 });
    },
    async memo() {
      await click(page.getByRole("button", { name: /Open the repository menu/ }).first(), { hold: 800 });
      await click(menuItem(t("Mémo Git")), { wait: 400, hold: 1400 });
      await click(page.getByRole("navigation", { name: t("Rubriques du mémo") }).getByText("Worktrees").first(), { hold: 2200 });
      await click(page.getByPlaceholder(t("Rechercher…")).first(), { hold: 200 });
      await typeText("cherry", 2);
      await page.waitForTimeout(250); await hold(2000);
      await press("Escape", 500);
    },
    async commit() {
      await page.evaluate(() => window.__demo.dirty());
      await press("F5", 300);
      await page.waitForTimeout(400);
      await click(page.getByTitle(t("Afficher les modifications en cours")).first(), { wait: 400, hold: 700 });
      await click(page.getByText("signup.css").first(), { wait: 300, hold: 1400 });
      await rightClick(page.getByText("signup.css").last(), { hold: 500 });
      await click(page.getByRole("menuitem", { name: /^Stage/ }).first(), { wait: 300, hold: 700 });
      await click(page.getByPlaceholder(en["Résumé du commit"] ?? "Commit summary").first(), { hold: 200 });
      await typeText("Newsletter: style the email field", 4);
      await hold(400);
      await press("Escape", 200);
      await click(page.getByRole("button", { name: /^Commit 1 file/ }).first(), { wait: 600, hold: 1400 });
      await rightClick(row("Newsletter: style the email field"), { hold: 2300 });
      await press("Escape", 400);
      await page.keyboard.press("Control+j"); await page.waitForTimeout(700); await hold(700);
      await page.locator(".xterm").first().click();
      await typeText("git log --oneline -3", 3);
      await press("Enter", 1700);
      await click(button(t("Journal")), { wait: 300, hold: 3000 });
    },
  };

  // Lignes de base des PR : la première synchronisation ne doit rien signaler.
  await quiet(async () => {
    await syncNow().click();
    await page.waitForTimeout(800);
  });

  let failed = false;
  for (const [name, scene] of Object.entries(scenes)) {
    const before = n;
    try {
      await scene();
      console.log("ok", name, n - before, "frames");
    } catch (e) {
      failed = true;
      console.log("FAIL", name, e.message.split("\n").slice(0, 4).join(" | "));
      await page.screenshot({ path: path.join(__dirname, `fail-${name}.png`) });
      break;
    }
  }
  fs.writeFileSync(path.join(OUT, "delays.json"), JSON.stringify(delays));
  console.log("frames", n, "seconds", delays.reduce((a, b) => a + b, 0) / 1000, failed ? "FAILED" : "");
  await browser.close();
  server.close();
  if (failed) process.exitCode = 1;
})();
