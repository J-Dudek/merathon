package com.gitclient.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * APK de debug seulement : lance tout de suite la vérification des PR en arrière-plan. WorkManager refuse d'exécuter
 * une tâche périodique avant son heure, même forcée par `cmd jobscheduler run -f` ; les tests passent donc par ici :
 * `adb shell am broadcast -n com.gitclient.app/.PrWatchRunNow --es dir <dossier de configuration>`.
 */
class PrWatchRunNow : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    MerathonPrWatch.runNow(context, intent.getStringExtra("dir") ?: context.dataDir.path)
  }
}
