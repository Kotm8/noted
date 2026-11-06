package com.noted.android.notifications

import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import androidx.work.*
import org.json.JSONObject

class NotificationSyncWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val state = PushState(applicationContext).read() ?: return Result.success()
        val origin = state.optString("origin")
        if (state.optString("binding") != inputData.getString("binding") || state.optString("secret").isBlank()) return Result.success()
        return try {
            val shown = applicationContext.getSystemService(NotificationManager::class.java).activeNotifications
                .filter { it.tag?.startsWith("$origin:") == true }
            val payload = inputData.getString("payload")?.let(::JSONObject)
            val incoming = payload?.let(PushNotifications::token)
            val tokens = (listOfNotNull(incoming) + shown.mapNotNull { it.notification.extras.getString("noted_token") }).distinct().take(100)
            if (tokens.isEmpty()) return Result.success()
            val query = tokens.joinToString("&") { "items=${Uri.encode(it)}" }
            val stale = PushHttp.request(origin, "/api/v1/notifications/android/reconcile?$query", "GET", secret = state.getString("secret")).getJSONArray("stale")
            if (PushState(applicationContext).read()?.optString("binding") != state.optString("binding")) return Result.success()
            val invalid = (0 until stale.length()).map { stale.getString(it) }.toSet()
            shown.filter { it.notification.extras.getString("noted_token") in invalid }.forEach {
                PushNotifications.cancelRevision(applicationContext, it.tag, it.notification.extras.getInt("noted_revision"))
            }
            if (payload != null && incoming != null && incoming !in invalid) PushNotifications.show(applicationContext, origin, payload)
            Result.success()
        } catch (error: PushHttpException) {
            if (error.status == 404) {
                inputData.getString("payload")?.let { PushNotifications.show(applicationContext, origin, JSONObject(it)) }
                Result.success()
            } else if (error.status in listOf(401, 403)) Result.failure() else Result.retry()
        } catch (_: Exception) { Result.retry() }
    }

    companion object {
        fun enqueue(context: Context, payload: JSONObject? = null) {
            val state = PushState(context).read() ?: return
            val builder = OneTimeWorkRequestBuilder<NotificationSyncWorker>()
                .setInputData(Data.Builder().putString("binding", state.optString("binding")).putString("payload", payload?.toString()).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            if (android.os.Build.VERSION.SDK_INT >= 31) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            val work = builder.build()
            WorkManager.getInstance(context).enqueueUniqueWork("noted-notification-sync-${payload?.let(PushNotifications::token) ?: "shown"}", ExistingWorkPolicy.REPLACE, work)
        }
    }
}
