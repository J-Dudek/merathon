import { useEffect, useState } from "react";
import { sshDeviceKeyDelete, sshDeviceKeyStatus } from "../ipc/commands";
import { errorMessage } from "../lib/actions";
import { confirmAction, useUiStore } from "../store/useUiStore";
import { useDisplayStore } from "../store/useDisplayStore";
import type { DeviceKeyStatus } from "../types/git";
import { tr } from "../i18n";

const buttonClass = "px-2.5 py-1.5 rounded-md border border-overlay/10 hover:bg-overlay/10 disabled:opacity-50";

/**
 * Préférences SSH sur Android (issue #38) : le SSH passe par une clé de l'Android Keystore, encore en essai. Désactivé par
 * défaut : les écrans SSH restent masqués tant que l'option n'est pas cochée.
 */
export function DeviceSshSection() {
  const enabled = useDisplayStore((s) => s.experimentalSsh);
  const update = useDisplayStore((s) => s.update);
  const notify = useUiStore((s) => s.notify);
  const [status, setStatus] = useState<DeviceKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setStatus(await sshDeviceKeyStatus());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove() {
    const ok = await confirmAction(
      tr("Supprimer la clé SSH de l'appareil ?"),
      tr("Elle ne pourra pas être récupérée. Retire-la aussi de tes forges, puis crée-en une autre avec Comptes > Configurer SSH…"),
      true,
    );
    if (!ok) return;
    try {
      await sshDeviceKeyDelete();
      notify("success", tr("Clé SSH de l'appareil supprimée"));
    } catch (e) {
      notify("error", errorMessage(e));
    }
    await load();
  }

  async function copy(publicKey: string) {
    await navigator.clipboard.writeText(publicKey);
    notify("success", tr("Clé publique copiée"));
  }

  return (
    <>
      <div className="mb-5">
        <h3 className="text-base font-semibold">{tr("SSH (expérimental)")}</h3>
        <p className="mt-0.5 text-[var(--color-muted)]">
          {tr("Clone, fetch, pull et push en SSH avec une clé créée dans le coffre de l'appareil (Android Keystore). Elle n'en sort jamais, et chaque connexion demande ton empreinte ou le code de l'appareil.")}
        </p>
      </div>

      <label className="flex items-start gap-2 mb-4 font-medium">
        <input type="checkbox" className="h-4 w-4 mt-0.5" checked={enabled} onChange={(e) => update({ experimentalSsh: e.target.checked })} />
        <span>
          {tr("Activer le SSH sur cet appareil")}
          <span className="block font-normal text-[11px] text-[var(--color-muted)]">
            {tr("Fait apparaître « Configurer SSH… » dans les comptes et accepte les URL SSH au clonage. Le HTTPS reste conseillé tant que ce mode est en essai.")}
          </span>
        </span>
      </label>

      <section aria-label={tr("Clé de l'appareil")} className="space-y-2">
        <h4 className="font-semibold">{tr("Clé de l'appareil")}</h4>
        {error && <p role="alert" className="text-amber-300 break-words">{error}</p>}
        {!status && !error && <p className="text-[var(--color-muted)]">{tr("Lecture de la clé de l'appareil…")}</p>}
        {status?.state === "absent" && <p className="text-[var(--color-muted)]">{tr("Aucune clé pour l'instant : elle se crée avec Comptes > Configurer SSH…")}</p>}
        {status?.message && <p role="alert" className="text-amber-300">{status.message}</p>}
        {status?.key && (
          <div className="space-y-1.5">
            <p className="font-mono text-[11px] break-all">{status.key.fingerprint}</p>
            <textarea readOnly rows={3} aria-label={tr("Clé publique")} className="w-full rounded border border-overlay/10 bg-transparent p-1.5 font-mono text-[10px] break-all" value={status.key.public_key} />
            <button className={buttonClass} onClick={() => void copy(status.key!.public_key)}>{tr("Copier la clé publique")}</button>
          </div>
        )}
        {(status?.state === "ready" || status?.state === "invalidated") && (
          <button className={`${buttonClass} text-red-400`} onClick={() => void remove()}>{tr("Supprimer la clé de l'appareil")}</button>
        )}
      </section>
    </>
  );
}
