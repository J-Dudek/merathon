import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { currentWindowLabel } from "./nativeWindow";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "./openExternal";
import { latestRelease, serverInfo, type LatestRelease } from "../ipc/commands";
import { useUiStore, type DialogSection } from "../store/useUiStore";
import { errorMessage } from "./actions";
import { tr, percent } from "../i18n";
import { hasNativeShell, isAndroid, isServer } from "./platform";

/** Libellé de progression du téléchargement (pourcentage connu seulement si le serveur annonce la taille). */
export function downloadLabel(received: number, total: number): string {
  const base = tr("Téléchargement de la mise à jour…");
  return total > 0 ? `${base} ${percent(Math.min(100, Math.round((received * 100) / total)))}` : base;
}

/**
 * Sépare, dans le champ `notes` de latest.json, le texte de la release du CHANGELOG.md complet ajouté par la CI.
 * Placé après « ### Téléchargements », ce CHANGELOG est ignoré par les versions qui ne le connaissent pas.
 */
export const CHANGELOG_MARKER = "<!-- merathon:changelog -->";

/**
 * Notes de version à afficher avant la mise à jour : celles de toutes les versions publiées depuis `currentVersion`,
 * la plus récente d'abord, d'après le CHANGELOG joint aux notes. Rubriques préfixées par leur version s'il y en a
 * plusieurs. Sans CHANGELOG joint : notes de la dernière release seulement.
 */
export function releaseNoteSections(body: string | undefined, currentVersion?: string): DialogSection[] {
  if (!body) return [];
  const [release, changelog] = body.split(CHANGELOG_MARKER);
  const latest = () => markdownSections(release.split("### Téléchargements")[0]);
  if (changelog === undefined || !currentVersion) return latest();
  const missed = changelogVersions(changelog).filter((v) => compareVersions(v.version, currentVersion) > 0);
  if (missed.length === 0) return latest();
  if (missed.length === 1) return missed[0].sections;
  return missed.flatMap((v) => v.sections.map((s) => ({ ...s, title: `${v.version} — ${s.title}` })));
}

/** Versions de CHANGELOG.md (titres « ## [x.y.z](…) (date) » ou « ## x.y.z (date) ») et leurs rubriques. */
function changelogVersions(changelog: string): { version: string; sections: DialogSection[] }[] {
  const versions: { version: string; sections: DialogSection[] }[] = [];
  for (const block of changelog.split(/^## /m).slice(1)) {
    const version = /^\[?(\d+\.\d+\.\d+)/.exec(block)?.[1];
    const sections = markdownSections(block);
    if (version && sections.length) versions.push({ version, sections });
  }
  return versions;
}

/** Ordre de deux versions « x.y.z » : négatif, nul ou positif. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Rubriques « ### » d'un texte Markdown et leurs éléments de liste.
 * Markdown simplifié en texte : liens et références de commit retirés, gras supprimé.
 */
function markdownSections(markdown: string): DialogSection[] {
  const sections: DialogSection[] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("### ")) {
      sections.push({ title: line.slice(4).trim(), items: [] });
      continue;
    }
    const text = line.trim();
    const isItem = text.startsWith("- ") || text.startsWith("* ");
    if (isItem && sections.length) sections[sections.length - 1].items.push(plainText(text.slice(2)));
  }
  return sections.filter((s) => s.items.length);
}

const COMMIT_REF = /^\(\[?[0-9a-f]{7,40}[\])]/;

function plainText(markdown: string): string {
  let text = markdown.trim();
  // Référence de commit en fin de ligne : « (abc1234) » ou « ([abc1234](url)) ».
  const ref = text.lastIndexOf(" (");
  if (ref >= 0 && text.endsWith(")") && COMMIT_REF.test(text.slice(ref + 1))) text = text.slice(0, ref);
  return stripLinks(text).split("**").join("").trim();
}

/** « [texte](url) » → « texte ». */
function stripLinks(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[", i);
    const mid = open < 0 ? -1 : text.indexOf("](", open);
    const close = mid < 0 ? -1 : text.indexOf(")", mid);
    if (close < 0) break;
    out += text.slice(i, open) + text.slice(open + 1, mid);
    i = close + 1;
  }
  return out + text.slice(i);
}

/**
 * Cherche une nouvelle version et propose de l'installer.
 * `manual` : demandé par l'utilisateur, qui est alors aussi prévenu quand l'appli est à jour ou en cas d'erreur.
 */
export async function checkForUpdates(manual = false) {
  if (isAndroid()) return checkAndroidUpdate(manual);
  if (isServer()) return checkServerUpdate(manual);
  // Sur iOS, le store gère les mises à jour : le plugin n'existe pas.
  if (!hasNativeShell()) return;
  const ui = useUiStore.getState();
  let update;
  try {
    update = await check();
  } catch (e) {
    if (manual) ui.notify("error", tr("Impossible de vérifier les mises à jour : {error}", { error: errorMessage(e) }));
    return;
  }
  if (!update) {
    if (manual) ui.notify("success", tr("Merathon est à jour"));
    return;
  }

  const answer = await ui.ask({
    title: tr("Merathon {version} est disponible", { version: update.version }),
    message: tr("Version installée : {currentVersion}. L'application redémarrera après l'installation.", { currentVersion: update.currentVersion }),
    sections: releaseNoteSections(update.body, update.currentVersion),
    confirmLabel: tr("Installer et redémarrer"),
  });
  if (!answer) return;

  let total = 0;
  let received = 0;
  ui.setBusy(downloadLabel(0, 0));
  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        received += event.data.chunkLength;
        ui.setBusy(downloadLabel(received, total));
      }
    });
    await relaunch();
  } catch (e) {
    ui.notify("error", tr("Échec de la mise à jour : {error}", { error: errorMessage(e) }));
  } finally {
    ui.setBusy(null);
  }
}

/**
 * Android : l'APK est distribué hors store, sans plugin de mise à jour. Merathon lit la dernière release publique et
 * propose d'en télécharger l'APK dans le navigateur ; Android l'installe ensuite par-dessus, données conservées.
 */
async function checkAndroidUpdate(manual: boolean) {
  const ui = useUiStore.getState();
  let latest: LatestRelease;
  let current: string;
  try {
    [latest, current] = await Promise.all([latestRelease(), getVersion()]);
  } catch (e) {
    if (manual) ui.notify("error", tr("Impossible de vérifier les mises à jour : {error}", { error: errorMessage(e) }));
    return;
  }
  if (compareVersions(latest.version, current) <= 0) {
    if (manual) ui.notify("success", tr("Merathon est à jour"));
    return;
  }
  // Release sans APK (publiée pour le bureau seulement) : rien à installer sur le téléphone.
  if (!latest.apkUrl) {
    if (manual) ui.notify("info", tr("Merathon {version} est sorti, mais sans APK Android pour l'instant.", { version: latest.version }));
    return;
  }
  const answer = await ui.ask({
    title: tr("Merathon {version} est disponible", { version: latest.version }),
    message: tr("Version installée : {currentVersion}. L'APK se télécharge dans le navigateur ; ouvre-le ensuite pour l'installer par-dessus (comptes et dépôts conservés).", { currentVersion: current }),
    sections: releaseNoteSections(latest.notes, current),
    confirmLabel: tr("Télécharger"),
  });
  if (!answer) return;
  try {
    await openUrl(latest.apkUrl);
  } catch (e) {
    ui.notify("error", tr("Ouverture du navigateur impossible : {error}", { error: errorMessage(e) }));
  }
}

/** Dernière vérification au chargement d'une page du NAS, et dernière version annoncée, propres à ce navigateur. */
const SERVER_CHECK_KEY = "merathon.update-check";
/** Une vérification par jour au plus au chargement : l'API publique de GitHub limite les appels par adresse (celle du NAS). */
const SERVER_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

interface ServerCheck {
  at: number;
  announced: string | null;
}

function readServerCheck(): ServerCheck {
  try {
    const saved = JSON.parse(localStorage.getItem(SERVER_CHECK_KEY) ?? "null") as Partial<ServerCheck> | null;
    return { at: typeof saved?.at === "number" ? saved.at : 0, announced: typeof saved?.announced === "string" ? saved.announced : null };
  } catch {
    return { at: 0, announced: null };
  }
}

function saveServerCheck(check: ServerCheck) {
  try {
    localStorage.setItem(SERVER_CHECK_KEY, JSON.stringify(check));
  } catch {
    // stockage indisponible (navigation privée) : la vérification sera refaite au prochain chargement
  }
}

/**
 * NAS : Merathon n'installe rien, le Centre de paquets de DSM (ou une nouvelle image Docker) s'en charge. Comme sur Android,
 * Merathon lit la dernière release publique (depuis le serveur : la CSP de la page interdit l'appel) et annonce seulement
 * qu'une version plus récente existe.
 *
 * Au chargement de la page : une fois par jour au plus, et un simple bandeau, une seule fois par version et par navigateur
 * (plusieurs personnes ouvrent Merathon, toutes ne peuvent pas mettre à jour le NAS). Demandée à la main : toujours, avec les
 * notes de la version et un lien vers sa page.
 */
async function checkServerUpdate(manual: boolean) {
  const ui = useUiStore.getState();
  const saved = readServerCheck();
  if (!manual && Date.now() - saved.at < SERVER_CHECK_EVERY_MS) return;
  let latest: LatestRelease;
  let current: string;
  try {
    [latest, current] = await Promise.all([latestRelease(), serverInfo().then((info) => info.version)]);
  } catch (e) {
    if (manual) ui.notify("error", tr("Impossible de vérifier les mises à jour : {error}", { error: errorMessage(e) }));
    return;
  }
  saveServerCheck({ ...saved, at: Date.now() });
  if (compareVersions(latest.version, current) <= 0) {
    if (manual) ui.notify("success", tr("Merathon est à jour"));
    return;
  }
  if (!manual) {
    if (saved.announced === latest.version) return;
    saveServerCheck({ at: Date.now(), announced: latest.version });
    ui.notify("info", tr("Merathon {version} est disponible (version du NAS : {currentVersion}) : mise à jour par le Centre de paquets de DSM, ou par une nouvelle image Docker.", { version: latest.version, currentVersion: current }));
    return;
  }
  const answer = await ui.ask({
    title: tr("Merathon {version} est disponible", { version: latest.version }),
    message: tr("Version du NAS : {currentVersion}. Merathon ne s'installe pas depuis cette page : mise à jour par le Centre de paquets de DSM (ou le paquet .spk de la release), ou par une nouvelle image Docker.", { currentVersion: current }),
    sections: releaseNoteSections(latest.notes, current),
    confirmLabel: tr("Voir la release"),
  });
  if (!answer || !latest.pageUrl) return;
  try {
    await openUrl(latest.pageUrl);
  } catch (e) {
    ui.notify("error", tr("Ouverture du navigateur impossible : {error}", { error: errorMessage(e) }));
  }
}

/** Vérification silencieuse au démarrage : version installée uniquement, depuis la fenêtre principale. */
export function checkForUpdatesOnStartup() {
  if (import.meta.env.DEV || currentWindowLabel() !== "main") return;
  checkForUpdates();
}
