import { hasDesktopFeatures, isServer } from "./platform";
import { useServerStore } from "../store/useServerStore";

/** Terminal intégré : pas sur mobile, et sur un NAS seulement si l'administrateur l'a autorisé (MERATHON_TERMINAL). */
export function useTerminalAvailable(): boolean {
  const allowedByServer = useServerStore((s) => s.info?.terminal ?? false);
  return hasDesktopFeatures() && (!isServer() || allowedByServer);
}
