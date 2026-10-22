package com.noted.android.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import com.noted.android.MainActivity
import com.noted.android.R
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ServerAddress
import com.noted.android.watch.WatchConnection
import java.util.UUID
import org.json.JSONObject

object PushNotifications {
    private const val channel = "noted_reminders"

    fun show(context: Context, origin: String, payload: JSONObject) {
        if (ConnectionStore(context).origin != origin) return
        if (
            android.os.Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) != PackageManager.PERMISSION_GRANTED
        )
            return
        val path = payload.optString("url", "/")
        val destination = Uri.parse(origin).buildUpon().build().toString() + path
        if (
            !path.startsWith("/") ||
                path.startsWith("//") ||
                !ServerAddress.owns(origin, destination)
        )
            return
        val diagnostic = payload.optString("kind") == "diagnostic"
        val plan = payload.optString("kind") == "plan"
        val ended = plan && payload.optString("phase") == "end"
        val writing = payload.optString("kind") == "writing"
        val identity =
            if (diagnostic) payload.optString("testId")
            else if (plan) payload.optString("promptId")
            else if (writing) payload.optString("writingPromptId")
            else payload.optString("messageId")
        if (runCatching { UUID.fromString(identity) }.isFailure) return
        val tag = "$origin:$identity"
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(channel, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Reminders from your Noted server"
            },
        )
        val open = Intent(context, MainActivity::class.java).setData(Uri.parse(destination))
        val builder =
            NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(payload.optString("title", "Noted").take(200))
                .setContentText(payload.optString("body").take(2000))
                .setStyle(
                    NotificationCompat.BigTextStyle().bigText(payload.optString("body").take(2000)),
                )
                .setContentIntent(
                    PendingIntent.getActivity(
                        context,
                        0,
                        open,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setLocalOnly(WatchConnection.receivesOwnNotifications(context, origin))
                .addExtras(
                    android.os.Bundle().apply {
                        putInt("noted_revision", payload.optInt("revision"))
                    },
                )
        val revision = payload.optInt("revision")
        if (plan && revision > 0) {
            val binding = PushState(context).read()?.optString("binding")
            val minutes =
                payload.optInt("snoozeMinutes", 5).takeIf { it in listOf(5, 10, 15, 30, 60) } ?: 5
            for (action in listOf(if (ended) "plan_stop" else "plan_start", "plan_delay")) {
                val intent =
                    Intent(context, PushActionReceiver::class.java)
                        .setData(
                            Uri.parse(
                                "noted-action://$action/$identity/$revision?origin=${Uri.encode(origin)}",
                            ),
                        )
                        .putExtra("origin", origin)
                        .putExtra("prompt_id", identity)
                        .putExtra("revision", revision)
                        .putExtra("action", action)
                        .putExtra("minutes", minutes)
                        .putExtra("tag", tag)
                        .putExtra("binding", binding)
                if (ended && action == "plan_delay")
                    intent.putExtra("reason", "Finishing up current task")
                val mutable =
                    if (android.os.Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
                val flags =
                    PendingIntent.FLAG_UPDATE_CURRENT or
                        (if (action == "plan_delay" && !ended) mutable
                        else PendingIntent.FLAG_IMMUTABLE)
                val pending = PendingIntent.getBroadcast(context, 0, intent, flags)
                val button =
                    NotificationCompat.Action.Builder(
                        0,
                        if (action == "plan_stop") "No activity"
                        else if (action == "plan_start") "Start"
                        else if (ended) "Snooze ${minutes}m" else "Delay ${minutes}m",
                        pending,
                    )
                if (action == "plan_delay" && !ended)
                    button.addRemoteInput(
                        RemoteInput.Builder("reason")
                            .setLabel("Reason for delaying")
                            .setChoices(
                                arrayOf(
                                    "Finishing up current task",
                                    "Taking a break",
                                    "Something came up",
                                ),
                            )
                            .setAllowFreeFormInput(true)
                            .build(),
                    )
                builder.addAction(button.build())
            }
            val more =
                Intent(context, PlanPromptActivity::class.java)
                    .setData(
                        Uri.parse("noted-plan://$identity/$revision?origin=${Uri.encode(origin)}"),
                    )
                    .putExtra("origin", origin)
                    .putExtra("prompt_id", identity)
                    .putExtra("binding", binding)
            builder.addAction(
                0,
                "More options",
                PendingIntent.getActivity(
                    context,
                    0,
                    more,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            runCatching {
                val time =
                    java.time.OffsetDateTime.parse(
                            payload.getString(if (ended) "plannedEnd" else "plannedStart"),
                        )
                        .atZoneSameInstant(
                            java.time.ZoneId.of(payload.optString("timezone", "UTC")),
                        )
                builder.setSubText(
                    "${if (ended) "Ended" else "Planned"} ${time.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))}",
                )
            }
        } else if (!diagnostic && !writing && revision > 0) {
            for (action in listOf("done", "snooze")) {
                val minutes = payload.optInt("snoozeMinutes", 10).coerceIn(1, 10080)
                val intent =
                    Intent(context, PushActionReceiver::class.java)
                        .setData(
                            Uri.parse(
                                "noted-action://$action/$identity/$revision?origin=${Uri.encode(origin)}",
                            ),
                        )
                        .putExtra("origin", origin)
                        .putExtra("message_id", identity)
                        .putExtra("revision", revision)
                        .putExtra("action", action)
                        .putExtra("minutes", minutes)
                        .putExtra("tag", tag)
                        .putExtra("binding", PushState(context).read()?.optString("binding"))
                builder.addAction(
                    0,
                    if (action == "done") "Done" else "Snooze ${minutes}m",
                    PendingIntent.getBroadcast(
                        context,
                        0,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            }
        }
        NotificationManagerCompat.from(context).notify(tag, 0, builder.build())
    }

    fun cancelRevision(context: Context, tag: String, revision: Int) {
        val current =
            context.getSystemService(NotificationManager::class.java).activeNotifications.find {
                it.tag == tag && it.id == 0
            }
        if (current?.notification?.extras?.getInt("noted_revision") == revision)
            NotificationManagerCompat.from(context).cancel(tag, 0)
    }
}
