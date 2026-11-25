package com.noted.android.features.tracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.noted.android.R
import com.noted.android.data.text
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import org.json.JSONObject

data class TrackerSnapshot(val state: JSONObject?, val activities: List<JSONObject>) {
    val active: JSONObject? get() = state?.optJSONObject("active")
    val paused: JSONObject? get() = state?.text("paused_activity_id")?.takeIf { it.isNotBlank() }?.let(::activity)
    val current: JSONObject? get() = active?.let { activity(it.text("activity_id")) }
    fun activity(id: String): JSONObject? = activities.firstOrNull { it.text("id") == id }
}

object TrackerNotification {
    private const val CHANNEL = "tracking"
    private const val ID = 4100

    fun clear(context: Context) {
        NotificationManagerCompat.from(context).cancel(ID)
        TrackerTileService.refresh(context)
    }

    fun show(
        context: Context,
        snapshot: TrackerSnapshot,
        open: Intent,
        actions: (String) -> PendingIntent,
    ) {
        val manager = NotificationManagerCompat.from(context)
        val active = snapshot.active
        val paused = snapshot.paused
        if ((active == null && paused == null) || !manager.areNotificationsEnabled()) { manager.cancel(ID); return }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Time tracking", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows what you're tracking, with Pause and Stop."
                setShowBadge(false)
            })
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(PendingIntent.getActivity(context, 0,
                open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        val activity = snapshot.current
        activity?.text("color")?.let { runCatching { builder.setColor(android.graphics.Color.parseColor(it)) } }
        if (active != null) {
            val started = runCatching { Instant.parse(active.text("started_at")) }.getOrNull() ?: Instant.now()
            val zone = snapshot.state?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() }
                ?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
            builder.setContentTitle(activity?.text("name") ?: "Tracking")
                .setContentText("Since ${started.atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm"))}")
                .setWhen(System.currentTimeMillis() -
                    (snapshot.state?.optLong("elapsed_seconds") ?: 0).coerceAtLeast(0) * 1000)
                .setShowWhen(true).setUsesChronometer(true)
                .setOngoing(true)
                .addAction(0, "Pause", actions("pause"))
                .addAction(0, "Stop", actions("stop"))
        } else {
            builder.setContentTitle("${paused!!.text("name")} paused")
                .setContentText("Resume when you're back.")
                .setShowWhen(false)
                .addAction(0, "Resume", actions("resume"))
                .addAction(0, "Stop", actions("stop"))
        }
        try { manager.notify(ID, builder.build()) } catch (_: SecurityException) { }
    }
}
