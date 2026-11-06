package com.noted.android.features.tracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.service.quicksettings.TileService
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.noted.android.MainActivity
import com.noted.android.NotedApplication
import com.noted.android.R
import com.noted.android.data.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

data class TrackerSnapshot(val state: JSONObject?, val activities: List<JSONObject>) {
    val active: JSONObject? get() = state?.optJSONObject("active")
    val paused: JSONObject? get() = state?.text("paused_activity_id")?.takeIf { it.isNotBlank() }?.let(::activity)
    val current: JSONObject? get() = active?.let { activity(it.text("activity_id")) }
    fun activity(id: String): JSONObject? = activities.firstOrNull { it.text("id") == id }
}

/**
 * The phone is mostly a time tracker, so the running activity lives in an ongoing notification and a
 * Quick Settings tile. Both are redrawn from the cached tracker whenever the app fetches it, so a change
 * made elsewhere shows up the next time the phone syncs rather than instantly.
 */
object TrackerNotification {
    private const val CHANNEL = "tracking"
    private const val ID = 4100
    const val ACTION = "com.noted.android.TRACKER_ACTION"
    val openTracker: Uri = Uri.parse("noted://tracker")

    suspend fun snapshot(repository: NativeRepository): TrackerSnapshot {
        val state = repository.cached("/time-tracking/tracker")?.let { runCatching { JSONObject(it) }.getOrNull() }
        val activities = repository.cached("/time-tracking/activities")?.let { runCatching { JSONArray(it).objects() }.getOrNull() }.orEmpty()
        return TrackerSnapshot(state, activities)
    }

    suspend fun refresh(context: Context, repository: NativeRepository) {
        show(context, if (repository.session.value == null) TrackerSnapshot(null, emptyList()) else snapshot(repository))
        runCatching { TileService.requestListeningState(context, ComponentName(context, TrackerTileService::class.java)) }
    }

    fun clear(context: Context) {
        NotificationManagerCompat.from(context).cancel(ID)
        runCatching { TileService.requestListeningState(context, ComponentName(context, TrackerTileService::class.java)) }
    }

    /** Runs a tracker action against the latest revision, so a stale notification can still stop what is running. */
    suspend fun act(context: Context, repository: NativeRepository, action: String, activityId: String? = null) {
        val state = JSONObject(repository.fetch("/time-tracking/tracker"))
        repository.mutate("/time-tracking/tracker", body = json("action" to action, "revision" to state.optInt("revision"),
            "activity_id" to activityId, "request_id" to UUID.randomUUID().toString()))
        repository.fetch("/time-tracking/tracker")
    }

    private fun show(context: Context, snapshot: TrackerSnapshot) {
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
                Intent(context, MainActivity::class.java).setData(openTracker).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        val activity = snapshot.current
        activity?.text("color")?.let { runCatching { builder.setColor(android.graphics.Color.parseColor(it)) } }
        if (active != null) {
            val started = runCatching { Instant.parse(active.text("started_at")) }.getOrNull() ?: Instant.now()
            val zone = snapshot.state?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() }
                ?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
            builder.setContentTitle(activity?.text("name") ?: "Tracking")
                .setContentText("Since ${started.atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm"))}")
                .setWhen(started.toEpochMilli()).setShowWhen(true).setUsesChronometer(true)
                .setOngoing(true)
                .addAction(0, "Pause", action(context, "pause"))
                .addAction(0, "Stop", action(context, "stop"))
        } else {
            builder.setContentTitle("${paused!!.text("name")} paused")
                .setContentText("Resume when you're back.")
                .setShowWhen(false)
                .addAction(0, "Resume", action(context, "resume"))
                .addAction(0, "Stop", action(context, "stop"))
        }
        try { manager.notify(ID, builder.build()) } catch (_: SecurityException) { }
    }

    private fun action(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(context, action.hashCode(),
        Intent(context, TrackerActionReceiver::class.java).setAction(ACTION).putExtra("action", action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}

class TrackerActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra("action")?.takeIf { it in listOf("pause", "resume", "stop") } ?: return
        val repository = (context.applicationContext as NotedApplication).repository
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                TrackerNotification.act(context, repository, action)
            } catch (_: Exception) {
                TrackerNotification.refresh(context, repository)
                withContext(Dispatchers.Main) {
                    Toast.makeText(context.applicationContext, "Couldn't reach your server.", Toast.LENGTH_SHORT).show()
                }
            } finally { pending.finish() }
        }
    }
}
