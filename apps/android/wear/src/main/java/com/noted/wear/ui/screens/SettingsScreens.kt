package com.noted.wear.ui.screens

import android.graphics.Color
import com.noted.wear.data.WatchData
import com.noted.wear.navigation.WatchDestination
import com.noted.wear.ui.DANGER
import com.noted.wear.ui.MUTED
import com.noted.wear.ui.SUCCESS
import com.noted.wear.ui.TestState
import com.noted.wear.ui.WatchUiState
import com.noted.wear.ui.WatchViewModel
import com.noted.wear.ui.WatchViews
import java.time.Instant
import java.time.ZoneId

fun WatchViews.settings(model: WatchViewModel, openWatchFace: () -> Unit) {
    text("Settings", 18f)
    text(
        "Layouts, text size, and favorites are in Noted's Settings › Watch appearance.",
        12f,
        Color.LTGRAY,
    )
    text("Last sync: ${clock(model.syncedAt())}", 12f, Color.GRAY)
    button("Watch face") { openWatchFace() }
    button("Sync now") { model.refresh() }
    button("Diagnostics", "bell") { model.open(WatchDestination.Diagnostics) }
    text("Hold the face, then Customize to change steps, sleep, and battery.", 11f, Color.GRAY)
    button("Disconnect watch") { model.disconnect() }
}

/**
 * D2: one answer first, the fix for the first problem as the main button, then
 * the details. The test counts only once the watch sees it arrive.
 */
fun WatchViews.diagnostics(state: WatchUiState, model: WatchViewModel, openSettings: () -> Unit) {
    label("DIAGNOSTICS")
    val allowed = model.notificationsAllowed()
    val registered = model.registeredAt()
    val test = state.test
    when {
        state.reachable == false -> {
            text("Offline", 24f)
            text("You can read cached data. Actions wait for a connection.", 11f, MUTED)
        }
        !allowed -> {
            text("Notifications are off", 22f, DANGER)
            button("Allow notifications", "bell", true) { openSettings() }
        }
        registered == 0L -> {
            text("Not set up yet", 22f, DANGER)
            text("This watch hasn't registered for notifications. Sync to try again.", 11f, MUTED)
            button("Sync now", "retry", true) { model.refresh() }
        }
        state.reachable == null -> text("Checking…", 22f)
        else -> {
            text("All good", 24f, SUCCESS)
            text("Notifications reach this watch.", 11f, MUTED)
        }
    }
    if (state.reachable != false) {
        val good = allowed && registered > 0 && state.reachable == true
        button(
            "Send test notification",
            "bell",
            primary = good,
            enabled = test != TestState.Sending && test !is TestState.Waiting,
        ) {
            model.sendTest()
        }
    }
    when (test) {
        TestState.Idle -> Unit
        TestState.Sending -> text("Sending…", 11f, MUTED)
        is TestState.Waiting -> text("Sent. Waiting…", 11f, MUTED)
        is TestState.Arrived ->
            if (allowed) text("✓ Arrived ${clock(test.at, seconds = true)}", 12f, SUCCESS)
            else text("It arrived, but can't show while notifications are off.", 11f, DANGER)
        is TestState.Failed -> text(test.message, 11f, DANGER)
    }
    divider()
    val synced = model.syncedAt()
    text(
        listOf(
                if (registered > 0) "Push registered ${clock(registered)}"
                else "Push not registered",
                if (state.reachable == false) "Server not reachable"
                else "Server ${model.serverName()}",
                if (synced > 0) "Last sync ${clock(synced)}" else "Never synced",
            )
            .joinToString("\n"),
        11f,
        MUTED,
    )
}

private fun clock(millis: Long, seconds: Boolean = false): String {
    val time = WatchData.time(Instant.ofEpochMilli(millis).toString())
    return if (!seconds) time
    else "$time:%02d".format(Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).second)
}
