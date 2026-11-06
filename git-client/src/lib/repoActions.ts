import { useTabsStore } from "../store/useTabsStore";
import { useUiStore } from "../store/useUiStore";
import { initRepository } from "../ipc/commands";
import { errorMessage } from "./actions";
import { pickFolder } from "./folderPicker";

/** Ouvre un dépôt dans un onglet (celui du dépôt s'il est déjà ouvert) ; les erreurs sont notifiées. */
export async function openRepoAt(path: string) {
  await useTabsStore.getState().openInTab(path);
}

export async function chooseAndOpenRepo() {
  const selected = await pickFolder();
  if (selected) await openRepoAt(selected);
}

export async function chooseAndInitRepo() {
  const selected = await pickFolder();
  if (!selected) return;
  try {
    await initRepository(selected);
    await openRepoAt(selected);
  } catch (e) {
    useUiStore.getState().notify("error", errorMessage(e));
  }
}
