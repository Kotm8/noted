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
import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.noted.wear.R
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import com.noted.wear.navigation.WatchIntentRouter
import com.noted.wear.ui.WatchActivity
import java.util.UUID
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
            if (payload.optString("kind") == "sync") {
                WatchRepository(this).refresh()
                WatchNotificationWorker.enqueue(this, credentials)
            } else if (payload.optString("kind") == "dismiss") {
                WatchNotifications.dismiss(this, payload.optString("id"), payload.optInt("revision"))
            }
            else if (payload.optString("kind") == "diagnostic") {
                recordTest(payload)
                WatchNotifications.show(this, payload, credentials, snapshot)
            } else WatchNotificationWorker.enqueue(this, credentials, payload)
        }
    }

    /** Diagnostics on the watch wait for this to know the server's test really arrived. */
    private fun recordTest(payload: JSONObject) {
        val id = payload.optString("testId")
        if (runCatching { UUID.fromString(id) }.isFailure) return
        WatchStore(this).saveTestArrival(id)
    }

    override fun onNewToken(token: String) {
        if (WatchStore(this).credentials() != null)
            runCatching {
                WatchRepository(this).request("push", JSONObject().put("token", token), "PUT")
            }
    }

    companion object {
        const val CHANNEL = "noted_watch_reminders"
    }
}

internal object WatchNotifications {
    fun dismiss(context: Context, id: String, revision: Int) {
        if (runCatching { UUID.fromString(id) }.isFailure) return
        val shown =
            context.getSystemService(NotificationManager::class.java)
                .activeNotifications
                .find { it.tag == id && it.id == 0 }
                ?.notification
                ?.extras
                ?.getInt("noted_revision") ?: return
        if (shown <= revision) NotificationManagerCompat.from(context).cancel(id, 0)
    }

    fun kind(payload: JSONObject) = payload.optString("kind").ifBlank { "reminder" }

    fun id(payload: JSONObject) = payload.optString(when (kind(payload)) {
        "plan" -> "promptId"
        "habit" -> "habitReminderId"
        "writing" -> "writingPromptId"
        "diagnostic" -> "testId"
        else -> "messageId"
    }).takeIf { runCatching { UUID.fromString(it) }.isSuccess }

    fun show(context: Context, payload: JSONObject, credentials: JSONObject, snapshot: JSONObject) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        )
            return
        val kind = kind(payload)
        val plan = kind == "plan"
        val reminder = kind == "reminder"
        val ended = plan && payload.optString("phase") == "end"
        val id = id(payload) ?: return
        val revision = payload.optInt("revision")
        val manager = context.getSystemService(NotificationManager::class.java)
        val shown = manager.activeNotifications.find { it.tag == id && it.id == 0 }
        if (shown != null && shown.notification.extras.getInt("noted_revision") >= revision) return
        manager.createNotificationChannel(
            NotificationChannel(WatchMessagingService.CHANNEL, "Noted reminders", NotificationManager.IMPORTANCE_HIGH),
        )
        val open =
            Intent(context, WatchActivity::class.java).setData(Uri.parse("noted-watch://open/$id"))
        if (plan || reminder)
            open.putExtra(if (plan) WatchIntentRouter.PROMPT else WatchIntentRouter.MESSAGE, id)
        val hide = snapshot.optJSONObject("settings")?.optBoolean("hide_contents") == true
        val body = if (hide) "Open Noted to view." else payload.optString("body").take(2000)
        val builder =
            NotificationCompat.Builder(context, WatchMessagingService.CHANNEL)
                .setSmallIcon(R.drawable.ic_noted)
                .setContentTitle(
                    if (hide) "Noted reminder" else payload.optString("title", "Noted").take(150),
                )
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(
                    PendingIntent.getActivity(
                        context,
                        0,
                        open,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                .setLocalOnly(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .addExtras(
                    android.os.Bundle().apply {
                        putInt("noted_revision", payload.optInt("revision"))
                        putString("noted_token", "$kind:$id:$revision")
                    },
                )
        if (revision > 0 && (plan || reminder)) {
            val action =
                Intent(context, WatchActionReceiver::class.java)
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
                        context,
                        0,
                        command,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                else
                    PendingIntent.getBroadcast(
                        context,
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
                        context,
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
                        context,
                        0,
                        snooze,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            }
        }
        NotificationManagerCompat.from(context).notify(id, 0, builder.build())
    }
}
