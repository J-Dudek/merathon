import { trimEndChars } from "./strings";

/** Échappe les caractères spéciaux d'un motif .gitignore pour désigner un chemin littéral. */
function escapePath(path: string): string {
  // Les espaces finaux sont ignorés par git s'ils ne sont pas échappés.
  const body = trimEndChars(path, " ");
  return body.replace(/([\\*?[\]])/g, "\\$1") + "\\ ".repeat(path.length - body.length);
}

/** Motif .gitignore désignant exactement ce fichier (ancré à la racine du dépôt). */
export function ignoreFilePattern(path: string): string {
  return `/${escapePath(path)}`;
}

/** Motif .gitignore du dossier contenant le fichier, ou null s'il est à la racine. */
export function ignoreFolderPattern(path: string): string | null {
  const end = path.lastIndexOf("/");
  return end > 0 ? `/${escapePath(path.slice(0, end))}/` : null;
}

/** Motif .gitignore de tous les fichiers de même extension (« *.log »), ou null sans extension. */
export function ignoreExtensionPattern(path: string): string | null {
  const ext = path.match(/[^/.]\.([^./]+)$/)?.[1];
  return ext ? `*.${escapePath(ext)}` : null;
}
