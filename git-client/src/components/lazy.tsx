// Fenêtres chargées à la demande : elles (et ce qu'elles seules utilisent, comme le rendu Markdown des PR) ne pèsent
// plus sur le démarrage, ce qui compte surtout sur téléphone. Mêmes noms et mêmes props que les composants d'origine.
import { lazy, Suspense, type ComponentType } from "react";

function onDemand<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Loaded = lazy(async () => ({ default: await load() }));
  function OnDemand(props: P) {
    // Le module se charge en quelques millisecondes depuis le disque : pas d'indicateur, la fenêtre apparaît ensuite.
    return (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    );
  }
  return OnDemand;
}

export const PullRequestReviewDialog = onDemand(() => import("./PullRequestReviewDialog").then((m) => m.PullRequestReviewDialog));
export const PullRequestDialog = onDemand(() => import("./PullRequestDialog").then((m) => m.PullRequestDialog));
export const SshSetupDialog = onDemand(() => import("./SshSetupDialog").then((m) => m.SshSetupDialog));
export const PreferencesDialog = onDemand(() => import("./PreferencesDialog").then((m) => m.PreferencesDialog));
export const GitMemoDialog = onDemand(() => import("./GitMemoDialog").then((m) => m.GitMemoDialog));
export const FileEditorDialog = onDemand(() => import("./FileEditorDialog").then((m) => m.FileEditorDialog));
export const CloneDialog = onDemand(() => import("./CloneDialog").then((m) => m.CloneDialog));
export const ConflictViewer = onDemand(() => import("./ConflictViewer").then((m) => m.ConflictViewer));
