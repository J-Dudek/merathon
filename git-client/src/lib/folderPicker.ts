import { open } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../store/useUiStore";
import { isMobile } from "./platform";

/** Demande un dossier : sélecteur du système sur le bureau, celui de l'application sur mobile (voir FolderPicker.tsx). */
export async function pickFolder(): Promise<string | null> {
  if (isMobile()) return useUiStore.getState().pickFolderInApp();
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
