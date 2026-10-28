package com.noted.wear.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.noted.wear.R
import com.noted.wear.data.WatchStore
import com.noted.wear.navigation.WatchIntentRouter
import com.noted.wear.ui.WatchActivity
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class WatchMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val credentials = WatchStore(this).credentials() ?: return
        val snapshot = WatchStore(this).snapshot() ?: return
        val client = snapshot.optJSONObject("firebase") ?: return
        if (
            message.data["origin"] != credentials.getString("origin") ||
                message.data["project"] != client.getString("project_id") ||
                message.from != client.getString("sender_id")
        )
            return
        val raw = message.data["payload"] ?: return
        if (raw.length > 4096) return
        runCatching {
            val payload = JSONObject(raw)
            if (payload.optString("kind") == "dismiss") dismiss(payload)
            else if (payload.optString("kind") == "diagnostic") {
                recordTest(payload)
                show(payload, credentials, snapshot)
            } else if (!phoneNearby())
                show(payload, credentials, snapshot)
        }
    }

    /** Diagnostics on the watch wait for this to know the server's test really arrived. */
    private fun recordTest(payload: JSONObject) {
        val id = payload.optString("testId")
        if (runCatching { UUID.fromString(id) }.isFailure) return
        WatchStore(this).saveTestArrival(id)
    }

    /** The phone's own notification is mirrored here, so only alert when it can't be. */
    private fun phoneNearby(): Boolean =
        runCatching {
                Tasks.await(
                        Wearable.getCapabilityClient(this)
                            .getCapability("noted_phone", CapabilityClient.FILTER_REACHABLE),
                        3,
                        TimeUnit.SECONDS,
                    )
                    .nodes
                    .isNotEmpty()
            }
            .getOrDefault(false)

    private fun dismiss(payload: JSONObject) {
        val id = payload.optString("id")
        if (runCatching { UUID.fromString(id) }.isFailure) return
        val shown =
            getSystemService(NotificationManager::class.java)
                .activeNotifications
                .find { it.tag == id && it.id == 0 }
                ?.notification
                ?.extras
                ?.getInt("noted_revision") ?: return
        if (shown <= payload.optInt("revision")) NotificationManagerCompat.from(this).cancel(id, 0)
    }

    private fun show(payload: JSONObject, credentials: JSONObject, snapshot: JSONObject) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        )
            return
        val plan = payload.optString("kind") == "plan"
        val ended = plan && payload.optString("phase") == "end"
        val id =
            payload.optString(
                if (plan) "promptId"
                else if (payload.optString("kind") == "diagnostic") "testId" else "messageId",
            )
        if (runCatching { UUID.fromString(id) }.isFailure) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Noted reminders", NotificationManager.IMPORTANCE_HIGH),
        )
        val open =
            Intent(this, WatchActivity::class.java)
                .setData(Uri.parse("noted-watch://open/$id"))
                .putExtra(if (plan) WatchIntentRouter.PROMPT else WatchIntentRouter.MESSAGE, id)
        val hide = snapshot.optJSONObject("settings")?.optBoolean("hide_contents") == true
        val body = if (hide) "Open Noted to view." else payload.optString("body").take(2000)
        val builder =
            NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_noted)
                .setContentTitle(
                    if (hide) "Noted reminder" else payload.optString("title", "Noted").take(150),
                )
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(
                    PendingIntent.getActivity(
                        this,
                        0,
                        open,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                .setLocalOnly(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .addExtras(
                    android.os.Bundle().apply { putInt("noted_revision", payload.optInt("revision")) },
                )
        val revision = payload.optInt("revision")
        if (revision > 0) {
            val action =
                Intent(this, WatchActionReceiver::class.java)
                    .setData(Uri.parse("noted-watch://action/$id/$revision"))
                    .putExtra("device_id", credentials.getString("device_id"))
                    .putExtra("id", id)
                    .putExtra("revision", revision)
                    .putExtra("path", "reminders")
                    .putExtra("action", "done")
            // Starting or stopping changes the tracker, so it opens the watch app,
            // which confirms with the server before saying it happened.
            val command =
                Intent(open)
                    .setData(Uri.parse("noted-watch://command/$id/$revision"))
                    .putExtra(WatchIntentRouter.ACTION, if (ended) "stop" else "start")
                    .putExtra(WatchIntentRouter.REVISION, revision)
            builder.addAction(
                0,
                if (ended) "No activity" else if (plan) "Start activity" else "Done",
                if (plan)
                    PendingIntent.getActivity(
                        this,
                        0,
                        command,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                else
                    PendingIntent.getBroadcast(
                        this,
                        0,
                        action,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
            )
            if (plan)
                builder.addAction(
                    0,
                    if (ended) "Snooze" else "Delay / other activity",
                    PendingIntent.getActivity(
                        this,
                        0,
                        Intent(open)
                            .setData(Uri.parse("noted-watch://delay/$id"))
                            .putExtra(WatchIntentRouter.DELAY, true),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            else {
                val snooze =
                    Intent(action)
                        .setData(Uri.parse("noted-watch://snooze/$id/$revision"))
                        .putExtra("action", "snooze")
                        .putExtra("minutes", payload.optInt("snoozeMinutes", 10).coerceIn(1, 10080))
                builder.addAction(
                    0,
                    "Snooze",
                    PendingIntent.getBroadcast(
                        this,
                        0,
                        snooze,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            }
        }
        NotificationManagerCompat.from(this).notify(id, 0, builder.build())
    }

    override fun onNewToken(token: String) {
        if (WatchStore(this).credentials() != null)
            runCatching {
                com.noted.wear.data
                    .WatchRepository(this)
                    .request("push", JSONObject().put("token", token), "PUT")
            }
    }

    companion object {
        const val CHANNEL = "noted_watch_reminders"
    }
}
