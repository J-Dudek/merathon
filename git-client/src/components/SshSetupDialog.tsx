import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleAlert, CircleCheck, Circle, LoaderCircle } from "lucide-react";
import { Modal, inputClass } from "./Modal";
import { sshCheckConnection, sshCreateKey, sshExistingKey, sshHostStatus, sshSetupInfo, sshTrustHost } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { hostOf } from "../lib/remoteUrl";
import { connectionHint, defaultKeyTitle, isKeyAlreadyRegistered, passphraseProblem, sshKeysPage } from "../lib/sshSetup";
import { useAccountsStore } from "../store/useAccountsStore";
import { useUiStore } from "../store/useUiStore";
import type { ForgeAccount } from "../types/forge";
import type { SshCheck, SshKeyInfo, SshSetupInfo } from "../types/git";
import { tr, quoted } from "../i18n";

type StepId = "key" | "upload" | "host" | "check";
type StepState = "waiting" | "running" | "done" | "failed";

const STEP_LABELS: Record<StepId, string> = {
  key: tr("Clé SSH"),
  upload: tr("Enregistrement sur le compte"),
  host: tr("Empreinte du serveur"),
  check: tr("Test de la connexion"),
};

const NEW_KEY = "__new__";
const WAITING: Record<StepId, { state: StepState; detail?: string }> = {
  key: { state: "waiting" }, upload: { state: "waiting" }, host: { state: "waiting" }, check: { state: "waiting" },
};

/** Bloquée sur une décision de l'utilisateur : clé à ajouter à la main, empreinte à valider, ou test à refaire. */
type Pause =
  | { kind: "manual"; error: string }
  | { kind: "fingerprint"; fingerprint: string }
  | { kind: "stopped" }
  | { kind: "finished"; check: SshCheck };

const buttonClass = "px-3 py-1.5 text-xs rounded bg-overlay/10 hover:bg-overlay/15 text-[var(--color-text)]";
const primaryClass = "px-3 py-1.5 text-xs rounded bg-[var(--color-accent-solid)] text-white disabled:opacity-50";

/** Assistant « Configurer SSH » d'un compte. Rien n'est écrit avant la validation du formulaire. */
export function SshSetupDialog({ account, fixedKey, onClose }: {
  account: ForgeAccount;
  /** Clé d'un profil Git : la seule proposée. */
  fixedKey?: SshKeyInfo;
  onClose: () => void;
}) {
  const host = hostOf(account.base_url) ?? "";
  const notify = useUiStore((s) => s.notify);
  const [info, setInfo] = useState<SshSetupInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [title, setTitle] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState(WAITING);
  const [pause, setPause] = useState<Pause | null>(null);
  const [key, setKey] = useState<SshKeyInfo | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;
    sshSetupInfo()
      .then((found) => {
        if (closed.current) return;
        const loaded = fixedKey ? { ...found, keys: [fixedKey], new_key_path: null } : found;
        setInfo(loaded);
        setChoice(loaded.keys[0]?.name ?? NEW_KEY);
        setTitle(defaultKeyTitle(loaded.machine));
      })
      .catch((e) => !closed.current && setLoadError(errorMessage(e)));
    return () => {
      closed.current = true;
    };
  }, [fixedKey]);

  const creating = choice === NEW_KEY;
  const mismatch = creating ? passphraseProblem(passphrase, confirmation) : null;
  const chosenPath = creating ? info?.new_key_path : info?.keys.find((k) => k.name === choice)?.path;
  const mark = (id: StepId, state: StepState, detail?: string) => setSteps((s) => ({ ...s, [id]: { state, detail } }));

  async function start() {
    setStarted(true);
    setPause(null);
    mark("key", "running");
    let selected: SshKeyInfo;
    try {
      selected = creating ? await sshCreateKey(title.trim(), passphrase || null) : await sshExistingKey(choice);
    } catch (e) {
      mark("key", "failed", errorMessage(e));
      setPause({ kind: "stopped" });
      return;
    } finally {
      setPassphrase("");
      setConfirmation("");
    }
    setKey(selected);
    mark("key", "done", `${selected.path} · ${selected.fingerprint}`);
    await upload(selected);
  }

  async function upload(selected: SshKeyInfo) {
    mark("upload", "running");
    try {
      const client = await useAccountsStore.getState().client(account);
      await client.addSshKey(title.trim(), selected.public_key);
      mark("upload", "done", quoted(title.trim()));
    } catch (e) {
      const message = errorMessage(e);
      if (!isKeyAlreadyRegistered(message)) {
        mark("upload", "failed", tr("Merathon n'a pas pu ajouter la clé"));
        setPause({ kind: "manual", error: message });
        return;
      }
      mark("upload", "done", tr("Clé déjà connue de la forge"));
    }
    await checkHost(selected);
  }

  async function addedByHand() {
    if (!key) return;
    setPause(null);
    mark("upload", "done", tr("Ajoutée sur la page de la forge"));
    await checkHost(key);
  }

  async function checkHost(selected: SshKeyInfo) {
    mark("host", "running");
    try {
      const status = await sshHostStatus(host);
      if (status.state === "known") {
        mark("host", "done", tr("Déjà connu dans known_hosts"));
      } else if (status.published) {
        await sshTrustHost(host, status.fingerprint);
        mark("host", "done", tr("Conforme à l'empreinte publiée : {fingerprint}", { fingerprint: status.fingerprint }));
      } else {
        mark("host", "waiting", tr("À valider"));
        setPause({ kind: "fingerprint", fingerprint: status.fingerprint });
        return;
      }
    } catch (e) {
      mark("host", "failed", errorMessage(e));
      setPause({ kind: "stopped" });
      return;
    }
    await checkConnection(selected);
  }

  async function trustFingerprint(fingerprint: string) {
    if (!key) return;
    setPause(null);
    mark("host", "running");
    try {
      await sshTrustHost(host, fingerprint);
      mark("host", "done", tr("Validée : {fingerprint}", { fingerprint }));
    } catch (e) {
      mark("host", "failed", errorMessage(e));
      setPause({ kind: "stopped" });
      return;
    }
    await checkConnection(key);
  }

  async function checkConnection(selected: SshKeyInfo) {
    setPause(null);
    mark("check", "running");
    try {
      const check = await sshCheckConnection(host, selected.name);
      mark("check", check.authenticated ? "done" : "failed", check.message);
      setPause({ kind: "finished", check });
      if (check.authenticated) notify("success", tr("Clé SSH configurée pour {label}", { label: account.label }));
    } catch (e) {
      mark("check", "failed", errorMessage(e));
      setPause({ kind: "stopped" });
    }
  }

  async function copyPublicKey() {
    if (!key) return;
    await navigator.clipboard.writeText(key.public_key);
    notify("success", tr("Clé publique copiée"));
  }

  return (
    <Modal title={tr("Configurer SSH · {label}", { label: account.label })} onClose={onClose} width="w-[560px]">
      <div className="px-4 py-3 space-y-3 text-xs text-[var(--color-text)] overflow-y-auto">
        {loadError && <p role="alert" className="text-red-400">{loadError}</p>}
        {!info && !loadError && <p className="text-[var(--color-muted)]">{tr("Lecture de ~/.ssh…")}</p>}
        {info && !started && (
          <>
            <fieldset className="space-y-1.5">
              <legend className="font-semibold mb-1">{tr("Clé à utiliser")}</legend>
              {info.keys.map((k) => (
                <label key={k.name} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="ssh-key" className="mt-0.5" checked={choice === k.name} onChange={() => setChoice(k.name)} />
                  <span className="min-w-0">
                    <span className="font-mono">{k.path}</span>
                    {k.encrypted && <span className="text-[var(--color-muted)]">{" "}{tr("· avec passphrase")}</span>}
                    <span className="block text-[10px] text-[var(--color-muted)] break-all">{k.fingerprint}</span>
                  </span>
                </label>
              ))}
              {info.new_key_path && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="ssh-key" className="mt-0.5" checked={creating} onChange={() => setChoice(NEW_KEY)} />
                  <span>{tr("Créer")}{" "}<span className="font-mono">{info.new_key_path}</span> (ed25519)</span>
                </label>
              )}
              {!info.new_key_path && info.keys.length === 0 && (
                <p role="alert" className="text-amber-300">
                  {tr("Un fichier id_ed25519 existe sans partie .pub lisible. Merathon ne l'écrase pas : régénère le .pub avec ssh-keygen -y, puis reviens ici.")}
                </p>
              )}
            </fieldset>

            {creating && (
              <div className="space-y-1.5">
                <label className="block">
                  <span className="block font-semibold mb-1">{tr("Passphrase (facultative)")}</span>
                  <input type="password" autoComplete="new-password" className={inputClass} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                </label>
                {passphrase && (
                  <label className="block">
                    <span className="block mb-1">{tr("Confirme la passphrase")}</span>
                    <input type="password" autoComplete="new-password" className={inputClass} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
                  </label>
                )}
                <p className="text-[11px] text-[var(--color-muted)]">
                  {tr("Sans passphrase, quiconque copie le fichier accède à tes dépôts. Avec, il faudra ajouter la clé à ton agent SSH (ssh-add) : Merathon ne la demande pas lors des fetch et push.")}
                </p>
                {mismatch && <p role="alert" className="text-amber-300">{mismatch}</p>}
              </div>
            )}

            <label className="block">
              <span className="block font-semibold mb-1">{tr("Nom de la clé sur {host}", { host })}</span>
              <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>

            <div>
              <p className="font-semibold mb-1">{tr("Ce qui va se passer")}</p>
              <ol className="list-decimal pl-4 space-y-0.5 text-[var(--color-muted)]">
                <li>{creating ? tr("Création de {chosenPath}. Aucun fichier existant n'est modifié.", { chosenPath }) : tr("Utilisation de {chosenPath}, sans la modifier.", { chosenPath })}</li>
                <li>
                  {tr("Envoi de la clé publique au compte {username} sur {host}.", { username: account.username, host })}
                  {account.provider === "github" && tr(" Le token doit avoir le scope write:public_key ; sinon, tu pourras l'ajouter à la main.")}
                </li>
                <li>{tr("Vérification de l'empreinte du serveur, ajoutée à ~/.ssh/known_hosts si elle n'y est pas.")}</li>
                <li>{tr("Test de la connexion SSH. Les remotes de tes dépôts ne changent pas.")}</li>
              </ol>
            </div>
          </>
        )}

        {started && (
          <ol aria-live="polite" className="space-y-2">
            {(Object.keys(STEP_LABELS) as StepId[]).map((id) => (
              <li key={id} className="flex items-start gap-2">
                <StepIcon state={steps[id].state} />
                <span className="min-w-0">
                  {STEP_LABELS[id]}
                  {steps[id].detail && <span className="block text-[11px] text-[var(--color-muted)] break-all">{steps[id].detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}

        {pause?.kind === "manual" && key && (
          <div className="space-y-2 border-t border-overlay/10 pt-3">
            <p role="alert" className="text-amber-300 break-words">{pause.error}</p>
            <p>{tr("Ajoute la clé publique toi-même sur {host}, puis continue :", { host })}</p>
            <textarea readOnly rows={3} aria-label={tr("Clé publique")} className={`${inputClass} font-mono text-[10px] break-all`} value={key.public_key} />
            <div className="flex gap-2">
              <button className={buttonClass} onClick={copyPublicKey}>{tr("Copier la clé publique")}</button>
              <button className={buttonClass} onClick={() => openUrl(sshKeysPage(account))}>{tr("Ouvrir la page de {host}", { host })}</button>
              <button className={primaryClass} onClick={addedByHand}>{tr("Clé ajoutée, continuer")}</button>
            </div>
          </div>
        )}

        {pause?.kind === "fingerprint" && (
          <div className="space-y-2 border-t border-overlay/10 pt-3">
            <p>
              {tr("{host} n'est pas encore connu, et Merathon n'a pas d'empreinte de référence pour cette instance. Compare celle-ci à celle donnée par son administrateur :", { host })}
            </p>
            <p className="font-mono break-all">{pause.fingerprint}</p>
            <div className="flex gap-2">
              <button className={primaryClass} onClick={() => trustFingerprint(pause.fingerprint)}>{tr("L'empreinte est correcte")}</button>
              <button className={buttonClass} onClick={onClose}>{tr("Annuler")}</button>
            </div>
          </div>
        )}

        {pause?.kind === "finished" && (
          <FinishedNote account={account} check={pause.check} encrypted={key?.encrypted ?? null} onRetry={() => key && checkConnection(key)} />
        )}
      </div>

      <div className="px-4 py-3 border-t border-overlay/10 flex justify-end gap-2">
        {!started ? (
          <>
            <button className={buttonClass} onClick={onClose}>{tr("Annuler")}</button>
            <button className={primaryClass} disabled={!info || !title.trim() || !!mismatch || !chosenPath} onClick={start}>{tr("Configurer")}</button>
          </>
        ) : (
          <button className={buttonClass} onClick={onClose}>{tr("Fermer")}</button>
        )}
      </div>
    </Modal>
  );
}

function FinishedNote({ account, check, encrypted, onRetry }: { account: ForgeAccount; check: SshCheck; encrypted: boolean | null; onRetry: () => void }) {
  if (!check.authenticated) {
    return (
      <div className="space-y-2 border-t border-overlay/10 pt-3">
        <p role="alert" className="text-amber-300">{connectionHint(encrypted, check.message)}</p>
        <button className={buttonClass} onClick={onRetry}>{tr("Vérifier à nouveau")}</button>
      </div>
    );
  }
  const otherAccount = check.username && check.username.toLowerCase() !== account.username.toLowerCase();
  return (
    <div className="space-y-1 border-t border-overlay/10 pt-3">
      {otherAccount && (
        <p role="alert" className="text-amber-300">
          {tr("Cette clé appartient au compte {username}, pas à {username2} : SSH agira en tant que {username}. Un seul compte par hôte est pris en charge pour l'instant.", { username: check.username, username2: account.username })}
        </p>
      )}
      <p className="text-[var(--color-muted)]">
        {tr("Les dépôts en SSH (git@…) peuvent utiliser cette clé. Ceux en HTTPS continuent d'utiliser le token.")}
      </p>
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  const className = "shrink-0 mt-0.5";
  if (state === "done") return <><CircleCheck size={13} className={`${className} text-green-400`} aria-hidden /><span className="sr-only">{tr("Terminé :")}{" "}</span></>;
  if (state === "failed") return <><CircleAlert size={13} className={`${className} text-amber-300`} aria-hidden /><span className="sr-only">{tr("Échec :")}{" "}</span></>;
  if (state === "running") return <><LoaderCircle size={13} className={`${className} animate-spin`} aria-hidden /><span className="sr-only">{tr("En cours :")}{" "}</span></>;
  return <><Circle size={13} className={`${className} text-[var(--color-muted)]`} aria-hidden /><span className="sr-only">{tr("À venir :")}{" "}</span></>;
}
