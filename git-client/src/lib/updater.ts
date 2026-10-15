import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiStore, type DialogSection } from "../store/useUiStore";
import { errorMessage } from "./actions";

/** Libellé de progression du téléchargement (pourcentage connu seulement si le serveur annonce la taille). */
export function downloadLabel(received: number, total: number): string {
  const base = "Téléchargement de la mise à jour…";
  return total > 0 ? `${base} ${Math.min(100, Math.round((received * 100) / total))} %` : base;
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
  const ui = useUiStore.getState();
  let update;
  try {
    update = await check();
  } catch (e) {
    if (manual) ui.notify("error", `Impossible de vérifier les mises à jour : ${errorMessage(e)}`);
    return;
  }
  if (!update) {
    if (manual) ui.notify("success", "Merathon est à jour");
    return;
  }

  const answer = await ui.ask({
    title: `Merathon ${update.version} est disponible`,
    message: `Version installée : ${update.currentVersion}. L'application redémarrera après l'installation.`,
    sections: releaseNoteSections(update.body, update.currentVersion),
    confirmLabel: "Installer et redémarrer",
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
    ui.notify("error", `Échec de la mise à jour : ${errorMessage(e)}`);
  } finally {
    ui.setBusy(null);
  }
}

/** Vérification silencieuse au démarrage : version installée uniquement, depuis la fenêtre principale. */
export function checkForUpdatesOnStartup() {
  if (import.meta.env.DEV || getCurrentWindow().label !== "main") return;
  checkForUpdates();
}
