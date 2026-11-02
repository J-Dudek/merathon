import type { ForgeAccount } from "../types/forge";
import { trimEndChars } from "./strings";

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

/** Une passphrase vide est acceptée ; une passphrase saisie doit être confirmée à l'identique. */
export function passphraseProblem(passphrase: string, confirmation: string): string | null {
  return passphrase === confirmation ? null : "Les deux passphrases sont différentes";
}

/** Explication d'un test de connexion refusé. */
export function connectionHint(encrypted: boolean | null, message: string): string {
  if (/permission denied/i.test(message) && encrypted !== false) {
    return "Si la clé a une passphrase, ajoute-la d'abord à ton agent SSH (ssh-add), puis vérifie à nouveau.";
  }
  if (/permission denied/i.test(message)) return "La forge ne reconnaît pas encore cette clé : vérifie qu'elle est bien enregistrée sur le compte.";
  return "Vérifie ta connexion et l'accès SSH à ce serveur. Une instance peut utiliser un autre hôte ou un autre port pour SSH.";
}
