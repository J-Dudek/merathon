import type { AppInfo } from "../ipc/commands";

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
  return info?.debug ? `${version} (développement)` : version;
}

/** Résumé de l'installation, à coller dans un rapport de bug. */
export function aboutReport(version: string, tauri: string, info: AppInfo | null): string {
  const lines = [`Merathon ${versionLabel(version, info)}`];
  if (info) lines.push(`Système : ${osLabel(info.os)} ${info.arch}`);
  if (tauri) lines.push(`Tauri : ${tauri}`);
  if (info) lines.push(`libgit2 : ${info.libgit2}`);
  return lines.join("\n");
}
