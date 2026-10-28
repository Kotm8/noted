package com.noted.android.notifications

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.noted.android.connection.ConnectionStore
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class NotedMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val state = PushState(this).read() ?: return
        if (state.optString("secret").isBlank()) return
        val origin = state.optString("origin")
        val client = state.optJSONObject("client") ?: return
        if (
            !PushIdentity.accepts(
                ConnectionStore(this).origin,
                origin,
                client.optString("project_id"),
                client.optString("sender_id"),
                message.data["origin"],
                message.data["project"],
                message.from,
            )
        )
            return
        val raw = message.data["payload"] ?: return
        if (raw.length > 4096) return
        runCatching {
            val payload = JSONObject(raw)
            if (payload.optString("kind") == "dismiss")
                PushNotifications.dismiss(this, origin, payload)
            else PushNotifications.show(this, origin, payload)
        }
    }

    override fun onNewToken(token: String) {
        val state = PushState(this).read() ?: return
        if (state.optString("secret").isBlank()) return
        val work =
            OneTimeWorkRequestBuilder<PushWorker>()
                .setInputData(
                    Data.Builder()
                        .putString("origin", state.getString("origin"))
                        .putString("binding", state.optString("binding"))
                        .putString("token", token)
                        .build(),
                )
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()
        WorkManager.getInstance(this)
            .enqueueUniqueWork("noted-push-token", ExistingWorkPolicy.REPLACE, work)
    }
}
