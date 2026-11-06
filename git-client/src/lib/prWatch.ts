// Android : vérification de l'activité des PR / MR quand l'application est fermée (tâche WorkManager, pr_watch.rs).
// Option des préférences, désactivée par défaut ; ce module tient la tâche à jour des réglages et reprend ses
// notifications au retour dans l'application.
import { useEffect } from "react";
import { prWatchConfigure, type PrWatchSettings } from "../ipc/commands";
import { useDisplayStore, type NotificationSettings } from "../store/useDisplayStore";
import { restoreBackgroundNotifications } from "./prNotifications";
import { isAndroid } from "./platform";

/** Réglages transmis à la tâche ; null si elle ne doit pas tourner. */
export function watchSettings(n: NotificationSettings, minutes: number, english: boolean): PrWatchSettings | null {
  if (!n.enabled || !n.background) return null;
  return { minutes, opened: n.opened, commits: n.commits, comments: n.comments, ci: n.ci, review: n.review, english };
}

export function usePrWatch() {
  const notifications = useDisplayStore((s) => s.notifications);
  const minutes = useDisplayStore((s) => s.backgroundInterval);
  const english = useDisplayStore((s) => s.language === "en");
  const settings = isAndroid() ? watchSettings(notifications, minutes, english) : null;
  // Clé stable : la tâche n'est reprogrammée que si un réglage qui la concerne change.
  const key = JSON.stringify(settings);

  useEffect(() => {
    if (!isAndroid()) return;
    prWatchConfigure(JSON.parse(key) as PrWatchSettings | null).catch((e) => console.warn("Vérification en arrière-plan :", e));
  }, [key]);

  useEffect(() => {
    if (!isAndroid()) return;
    const restore = () => {
      if (document.visibilityState === "visible") restoreBackgroundNotifications().catch((e) => console.warn("Notifications de la tâche :", e));
    };
    restore();
    document.addEventListener("visibilitychange", restore);
    return () => document.removeEventListener("visibilitychange", restore);
  }, []);
}
