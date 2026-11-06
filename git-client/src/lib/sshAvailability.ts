import { useDisplayStore } from "../store/useDisplayStore";
import { isMobile } from "./platform";

/**
 * Le SSH est-il proposé ? Toujours sur le bureau. Sur mobile, seulement avec le réglage « SSH (expérimental) » :
 * la clé de l'Android Keystore n'est pas encore validée sur assez d'appareils (issue #38).
 */
export function sshAvailable(): boolean {
  return !isMobile() || useDisplayStore.getState().experimentalSsh;
}

/** Comme `sshAvailable`, mis à jour quand le réglage change. */
export function useSshAvailable(): boolean {
  const experimental = useDisplayStore((s) => s.experimentalSsh);
  return !isMobile() || experimental;
}
