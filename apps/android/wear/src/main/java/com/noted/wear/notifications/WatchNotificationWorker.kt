package com.noted.wear.notifications

import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.noted.wear.data.WatchHttpException
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import org.json.JSONObject

class WatchNotificationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val context = applicationContext
        val store = WatchStore(context)
        val credentials = store.credentials() ?: return Result.success()
        val deviceId = inputData.getString("device")
        if (credentials.optString("device_id") != deviceId) return Result.success()
        val payload = inputData.getString("payload")?.let(::JSONObject)
        val incoming = payload?.let { token(it) }
        val shown = context.getSystemService(NotificationManager::class.java).activeNotifications
        val items = (listOfNotNull(incoming) + shown.mapNotNull {
            it.notification.extras.getString("noted_token")?.takeUnless { token -> token.startsWith("diagnostic:") }
        }).distinct().take(100)
        if (items.isEmpty()) return Result.success()
        return try {
            val query = items.joinToString("&") { "items=${Uri.encode(it)}" }
            val stale = WatchRepository(context).request("notifications/reconcile?$query").getJSONArray("stale")
            if (store.credentials()?.optString("device_id") != deviceId) return Result.success()
            val invalid = (0 until stale.length()).map { stale.getString(it) }.toSet()
            shown.filter { it.notification.extras.getString("noted_token") in invalid }.forEach {
                WatchNotifications.dismiss(context, it.tag ?: return@forEach, it.notification.extras.getInt("noted_revision"))
            }
            if (payload != null && incoming != null && incoming !in invalid)
                store.snapshot()?.let { WatchNotifications.show(context, payload, credentials, it) }
            Result.success()
        } catch (error: WatchHttpException) {
            if (error.status == 404 && payload != null && store.credentials()?.optString("device_id") == deviceId) {
                store.snapshot()?.let { WatchNotifications.show(context, payload, credentials, it) }
                Result.success()
            } else if (error.status in listOf(401, 403, 404)) Result.failure() else retry()
        } catch (_: Exception) {
            retry()
        }
    }

    private fun retry() = if (runAttemptCount < 8) Result.retry() else Result.failure()

    companion object {
        private fun token(payload: JSONObject): String? =
            WatchNotifications.id(payload)?.let { "${WatchNotifications.kind(payload)}:$it:${payload.optInt("revision")}" }

        fun enqueue(context: Context, credentials: JSONObject, payload: JSONObject? = null) {
            val item = payload?.let(::token)
            if (payload != null && item == null) return
            val work = OneTimeWorkRequestBuilder<WatchNotificationWorker>()
                .setInputData(workDataOf("device" to credentials.optString("device_id"), "payload" to payload?.toString()))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("watch-notifications-${item ?: "shown"}", ExistingWorkPolicy.KEEP, work)
        }
    }
}
