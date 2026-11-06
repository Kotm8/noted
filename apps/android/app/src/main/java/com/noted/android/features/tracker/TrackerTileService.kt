package com.noted.android.features.tracker

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.noted.android.MainActivity
import com.noted.android.NotedApplication
import com.noted.android.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Tapping stops what's running; with nothing running it opens the activity picker in the app. */
class TrackerTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val repository get() = (application as NotedApplication).repository

    override fun onStartListening() {
        super.onStartListening()
        scope.launch { draw(withContext(Dispatchers.IO) { TrackerNotification.snapshot(repository) }) }
    }

    override fun onClick() {
        super.onClick()
        scope.launch {
            val snapshot = withContext(Dispatchers.IO) { TrackerNotification.snapshot(repository) }
            if (repository.session.value != null && snapshot.active != null) {
                qsTile?.apply { state = Tile.STATE_UNAVAILABLE; updateTile() }
                val stopped = withContext(Dispatchers.IO) {
                    runCatching { TrackerNotification.act(this@TrackerTileService, repository, "stop") }.isSuccess
                }
                if (!stopped) TrackerNotification.refresh(this@TrackerTileService, repository)
                draw(withContext(Dispatchers.IO) { TrackerNotification.snapshot(repository) })
            } else openPicker()
        }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openPicker() {
        val intent = Intent(this, MainActivity::class.java).setData(TrackerNotification.openTracker)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        else @Suppress("DEPRECATION") startActivityAndCollapse(intent)
    }

    private fun draw(snapshot: TrackerSnapshot) {
        val tile = qsTile ?: return
        val running = snapshot.current
        tile.icon = Icon.createWithResource(this, R.drawable.noted_timer)
        tile.label = running?.optString("name")?.takeIf { it.isNotBlank() } ?: if (snapshot.active != null) "Tracking" else "Track time"
        tile.state = if (snapshot.active != null) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= 29) tile.subtitle = when {
            snapshot.active != null -> "Tap to stop"
            snapshot.paused != null -> "${snapshot.paused!!.optString("name")} paused"
            else -> "Choose an activity"
        }
        tile.updateTile()
    }
}
