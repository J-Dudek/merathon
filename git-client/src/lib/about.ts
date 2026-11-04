import type { AppInfo } from "../ipc/commands";
import { tr } from "../i18n";

export const REPO_URL = "https://github.com/J-Dudek/merathon";

/** Page de la release d'une version ; liste des releases tant que la version n'est pas connue. */
export function releaseUrl(version: string): string {
  return version ? `${REPO_URL}/releases/tag/v${version}` : `${REPO_URL}/releases`;
}

const OS_LABELS: Record<string, string> = { linux: "Linux", windows: "Windows", macos: "macOS" };

/** Nom lisible du système (`std::env::consts::OS`). */
export function osLabel(os: string): string {
  return OS_LABELS[os] ?? os;
}

/** Version affichée : les builds `tauri dev` sont signalés. */
export function versionLabel(version: string, info: AppInfo | null): string {
  return info?.debug ? tr("{version} (développement)", { version }) : version;
}

/** Résumé de l'installation, à coller dans un rapport de bug. */
export function aboutReport(version: string, tauri: string, info: AppInfo | null): string {
  const lines = [`Merathon ${versionLabel(version, info)}`];
  if (info) lines.push(tr("Système : {osLabel} {arch}", { osLabel: osLabel(info.os), arch: info.arch }));
  if (tauri) lines.push(tr("Tauri : {tauri}", { tauri }));
  if (info) lines.push(tr("libgit2 : {libgit2}", { libgit2: info.libgit2 }));
  return lines.join("\n");
}
