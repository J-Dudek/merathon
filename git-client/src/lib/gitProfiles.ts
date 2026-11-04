import { trimEndChars } from "./strings";
import type { GitProfile, IdentityStatus } from "../types/git";
import { tr } from "../i18n";

const normalize = (path: string) => trimEndChars(path.replace(/\\/g, "/"), "/");

/** Profil lié à un compte, pour proposer son dossier au clone. */
export function profileForAccount(profiles: GitProfile[], accountId: string): GitProfile | undefined {
  return profiles.find((p) => p.account_id === accountId);
}

/** Profil qui couvrira un dépôt cloné dans ce dossier (ou dans un de ses sous-dossiers). */
export function profileForDir(profiles: GitProfile[], dir: string): GitProfile | undefined {
  if (!dir) return undefined;
  const target = normalize(dir);
  return profiles.find((p) => target === normalize(p.dir) || target.startsWith(`${normalize(p.dir)}/`));
}

/** Nom de fichier proposé pour la clé d'un profil. */
export function keyNameFor(label: string): string {
  const slug = label.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().split(/[^a-z0-9]/).filter(Boolean).join("_");
  return `id_ed25519_${slug || "profil"}`;
}

export interface IdentityIssue {
  message: string;
  /** Le réglage vient du dépôt : le retirer suffit à reprendre celui du profil. */
  canUseProfile: boolean;
}

/** Commit qui ne serait pas signé avec l'e-mail du profil du dépôt ; null si tout est cohérent. */
export function identityIssue(status: IdentityStatus | null): IdentityIssue | null {
  if (!status?.mismatch || !status.profile) return null;
  const expected = tr("le profil « {label} » prévoit {user_email}", { label: status.profile.label, user_email: status.profile.user_email });
  const actual = status.email ?? tr("aucun e-mail");
  if (status.origin === "repo") {
    return { message: tr("Ce dépôt signe ses commits avec {actual} (réglage du dépôt), alors que {expected}.", { actual, expected }), canUseProfile: true };
  }
  return {
    message: tr("Les commits seraient signés avec {actual}, alors que {expected}. Dans ~/.gitconfig, place la section [user] avant les règles includeIf.", { actual, expected }),
    canUseProfile: false,
  };
}
