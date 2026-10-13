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
 * Notes de version tirées du texte de la release (champ `notes` de latest.json) :
 * rubriques du changelog seulement, sans le titre ni les sections Téléchargements / SmartScreen / empreintes.
 * Markdown simplifié en texte : liens et références de commit retirés, gras supprimé.
 */
export function releaseNoteSections(body: string | undefined): DialogSection[] {
  if (!body) return [];
  const changelog = body.split("### Téléchargements")[0];
  const sections: DialogSection[] = [];
  for (const line of changelog.split("\n")) {
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
    sections: releaseNoteSections(update.body),
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
