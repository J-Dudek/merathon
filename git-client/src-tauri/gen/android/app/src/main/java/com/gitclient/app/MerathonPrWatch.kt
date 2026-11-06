package com.gitclient.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Activité des PR / MR vérifiée quand Merathon est fermé : option des préférences, désactivée par défaut.
 *
 * Programmée et annulée depuis Rust (src-tauri/src/pr_watch.rs) quand l'option change. WorkManager lance [Check]
 * à l'intervalle choisi (15 min au minimum), seulement avec du réseau, en regroupant les réveils avec ceux des autres
 * applications ; la programmation survit au redémarrage du téléphone. [Check] appelle Rust, qui fait les requêtes et
 * compare avec la dernière liste connue, puis affiche les notifications renvoyées : le lanceur en tire la pastille.
 */
object MerathonPrWatch {
  private const val TAG = "MerathonPrWatch"
  private const val WORK = "merathon-pr-watch"
  private const val CHANNEL = "merathon-pr-activity"
  /** Étiquette des notifications de la tâche : leurs identifiants ne se mêlent pas à ceux du plugin de notifications. */
  private const val NOTIFICATION_TAG = "merathon-pr-watch"
  private const val DIR = "dir"

  @JvmStatic
  fun schedule(context: Context, minutes: Long, dir: String) {
    val request = PeriodicWorkRequestBuilder<Check>(minutes, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setInputData(workDataOf(DIR to dir))
      .build()
    // UPDATE : un nouvel intervalle remplace l'ancien sans repartir de zéro.
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    Log.i(TAG, "vérification programmée toutes les $minutes min")
  }

  @JvmStatic
  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(WORK)
    Log.i(TAG, "vérification annulée")
  }

  /** Une vérification tout de suite, hors programmation (tests, voir src/debug/…/PrWatchRunNow.kt). */
  fun runNow(context: Context, dir: String) {
    WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<Check>().setInputData(workDataOf(DIR to dir)).build())
  }

  /** Retire une notification de la tâche, dont toutes les PR ont été consultées. */
  @JvmStatic
  fun dismiss(context: Context, id: Int) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_TAG, id)
  }

  /** Vérification par Rust : JSON `{ok: {notifications, channel, errors}}` ou `{error}`. */
  @JvmStatic
  private external fun check(dir: String): String

  class Check(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
      // Au premier plan, l'application vérifie elle-même (et affiche un simple bandeau) : rien à faire ici.
      if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
        Log.i(TAG, "application au premier plan : elle vérifie elle-même")
        return Result.success()
      }
      val dir = inputData.getString(DIR) ?: return Result.failure()
      // Processus lancé par WorkManager sans l'activité : la bibliothèque Rust n'est pas encore chargée.
      System.loadLibrary("merathon_lib")
      val response = JSONObject(check(dir))
      val result = response.optJSONObject("ok")
      if (result == null) {
        Log.w(TAG, "vérification impossible : ${response.optString("error")}")
        return Result.success() // prochain passage à l'intervalle normal
      }
      val errors = result.getJSONArray("errors")
      for (i in 0 until errors.length()) Log.w(TAG, "compte en échec : ${errors.getString(i)}")
      val notifications = result.getJSONArray("notifications")
      Log.i(TAG, "vérification faite : ${notifications.length()} notification(s)")
      if (notifications.length() > 0) show(result.getString("channel"), notifications)
      return Result.success()
    }

    private fun show(channelName: String, notifications: org.json.JSONArray) {
      val manager = NotificationManagerCompat.from(applicationContext)
      if (!manager.areNotificationsEnabled()) {
        Log.w(TAG, "notifications refusées pour Merathon : rien d'affiché")
        return
      }
      // Créé (ou renommé, si la langue a changé) à chaque fois : sans effet sur les réglages choisis par l'utilisateur.
      manager.createNotificationChannel(NotificationChannel(CHANNEL, channelName, NotificationManager.IMPORTANCE_DEFAULT))
      val launch = applicationContext.packageManager.getLaunchIntentForPackage(applicationContext.packageName)
        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val open = launch?.let { PendingIntent.getActivity(applicationContext, 0, it, PendingIntent.FLAG_IMMUTABLE) }
      for (i in 0 until notifications.length()) {
        val n = notifications.getJSONObject(i)
        val body = n.getString("body")
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL)
          .setSmallIcon(R.drawable.ic_stat_merathon)
          .setContentTitle(n.getString("title"))
          .setContentText(body.lineSequence().first())
          .setStyle(NotificationCompat.BigTextStyle().bigText(body))
          .setContentIntent(open)
          .setAutoCancel(true)
          .setCategory(NotificationCompat.CATEGORY_SOCIAL)
          .build()
        try {
          manager.notify(NOTIFICATION_TAG, n.getInt("id"), notification)
        } catch (e: SecurityException) {
          Log.w(TAG, "notification refusée : ${e.message}")
        }
      }
    }
  }
}
