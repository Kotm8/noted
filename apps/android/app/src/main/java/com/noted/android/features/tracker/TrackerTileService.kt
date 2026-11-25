package com.noted.android.features.tracker

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import com.noted.android.MainActivity
import com.noted.android.pilot.PilotTracker
import com.noted.android.connection.ConnectionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class TrackerTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var busy = false

    override fun onStartListening() {
        super.onStartListening()
        if (!busy) scope.launch { draw(runCatching { PilotTracker.state(this@TrackerTileService) }) }
    }

    override fun onClick() {
        super.onClick()
        if (busy || isLocked) return
        busy = true
        scope.launch {
            try {
                val state = PilotTracker.state(this@TrackerTileService)
                if (state?.tracker?.active == null) {
                    openPicker(state?.origin ?: ConnectionStore(this@TrackerTileService).origin)
                } else {
                    val revision = state.tracker.state?.optInt("revision") ?: return@launch
                    PilotTracker.sync(this@TrackerTileService, "stop", state.binding, revision)
                }
            } catch (_: Exception) {
                Toast.makeText(this@TrackerTileService, "Couldn't reach your server.", Toast.LENGTH_SHORT).show()
            } finally {
                busy = false
                draw(runCatching { PilotTracker.state(this@TrackerTileService) })
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openPicker(origin: String?) {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (origin != null) intent.data = Uri.parse("$origin/?track=1")
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 2, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun draw(result: Result<PilotTracker.State?>) {
        val tile = qsTile ?: return
        val tracker = result.getOrNull()?.tracker
        tile.label = tracker?.current?.optString("name")?.takeIf { it.isNotBlank() } ?: "Track time"
        tile.state = when {
            tracker?.active != null -> Tile.STATE_ACTIVE
            result.isFailure -> Tile.STATE_UNAVAILABLE
            else -> Tile.STATE_INACTIVE
        }
        if (Build.VERSION.SDK_INT >= 29) tile.subtitle = when {
            tracker?.active != null -> "Tap to stop"
            result.isFailure -> "Reconnect to track"
            result.getOrNull() == null -> "Open Noted"
            else -> "Choose an activity"
        }
        tile.updateTile()
    }

    companion object {
        internal fun refresh(context: Context) {
            runCatching {
                requestListeningState(context, ComponentName(context, TrackerTileService::class.java))
            }
        }
    }
}
