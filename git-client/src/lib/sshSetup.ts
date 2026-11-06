import type { ForgeAccount } from "../types/forge";
import { trimEndChars } from "./strings";
import { tr } from "../i18n";

/** Nom proposé pour la clé sur la forge, pour pouvoir la retrouver et la révoquer. */
export const defaultKeyTitle = (machine: string) => `Merathon – ${machine}`;

/** La forge connaît déjà cette clé : pas une erreur, le test de connexion dira à quel compte elle appartient. */
export function isKeyAlreadyRegistered(message: string): boolean {
  return /already in use|already been taken|has already/i.test(message);
}

/** Page de la forge où ajouter la clé à la main. */
export function sshKeysPage(account: Pick<ForgeAccount, "provider" | "base_url">): string {
  const base = trimEndChars(account.base_url);
  return account.provider === "github" ? `${base}/settings/ssh/new` : `${base}/-/user_settings/ssh_keys`;
}

/** Préfixe posé par le backend (`HOST_PROBLEM_MARKER`) quand le test de connexion échoue à cause de l'hôte. */
const HOST_PROBLEM_MARKER = "ssh-host-problem: ";

/** Problème d'hôte (inconnu, clé modifiée) signalé par le test de connexion, sans le préfixe ; null sinon. */
export function hostProblem(message: string): string | null {
  const at = message.indexOf(HOST_PROBLEM_MARKER);
  return at < 0 ? null : message.slice(at + HOST_PROBLEM_MARKER.length);
}

/** Une passphrase vide est acceptée ; une passphrase saisie doit être confirmée à l'identique. */
export function passphraseProblem(passphrase: string, confirmation: string): string | null {
  return passphrase === confirmation ? null : tr("Les deux passphrases sont différentes");
}

/** Explication d'un test de connexion refusé. */
export function connectionHint(encrypted: boolean | null, message: string): string {
  // Clé de l'appareil (Android) : refus de la forge, ou confirmation annulée.
  if (/refuse la clé de cet appareil|refuses this device's key/i.test(message)) {
    return tr("La forge ne reconnaît pas encore cette clé : vérifie qu'elle est bien enregistrée sur le compte.");
  }
  if (/^Confirmation (annulée|cancelled)/.test(message)) return tr("Confirmation annulée : vérifie à nouveau pour la redemander.");
  if (/permission denied/i.test(message) && encrypted !== false) {
    return tr("Si la clé a une passphrase, ajoute-la d'abord à ton agent SSH (ssh-add), puis vérifie à nouveau.");
  }
  if (/permission denied/i.test(message)) return tr("La forge ne reconnaît pas encore cette clé : vérifie qu'elle est bien enregistrée sur le compte.");
  return tr("Vérifie ta connexion et l'accès SSH à ce serveur. Une instance peut utiliser un autre hôte ou un autre port pour SSH.");
}
