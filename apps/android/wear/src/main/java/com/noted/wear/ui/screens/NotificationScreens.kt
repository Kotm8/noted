package com.noted.wear.ui.screens

import com.noted.wear.data.Outdated
import com.noted.wear.data.OutdatedReason
import com.noted.wear.data.WatchData
import com.noted.wear.navigation.WatchDestination
import com.noted.wear.ui.CommandState
import com.noted.wear.ui.DANGER
import com.noted.wear.ui.MUTED
import com.noted.wear.ui.SUCCESS
import com.noted.wear.ui.WatchUiState
import com.noted.wear.ui.WatchViewModel
import com.noted.wear.ui.WatchViews
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * C2: a short, centred confirmation. A spinner while the server answers, then
 * a drawn check. Never claims success before the server confirms.
 */
fun WatchViews.command(
    command: WatchDestination.Command,
    state: WatchUiState,
    model: WatchViewModel,
) {
    center()
    val title = state.commandPrompt?.title ?: "Planned activity"
    val starting = command.action == "start"
    when (val status = state.command) {
        CommandState.Running,
        CommandState.Slow -> {
            spinner()
            text(if (starting) "Starting" else "Stopping", 13f, MUTED)
            text(title, 18f)
            if (status == CommandState.Slow)
                text("Still waiting for your server. It won't happen twice.", 11f, MUTED)
        }
        CommandState.Done -> {
            ring(true, accent)
            text(title, 21f)
            val time = DateTimeFormatter.ofPattern("HH:mm").format(LocalTime.now())
            text(if (starting) "Started $time" else "Stopped $time", 12f, MUTED)
        }
        is CommandState.Failed -> {
            ring(false, DANGER)
            text(if (starting) "Not started" else "Not stopped", 16f)
            text(status.message, 12f, MUTED)
            text("Trying again is safe. It won't happen twice.", 11f, MUTED)
            button("Try again", "retry", true) { model.runCommand(command) }
            button("Home", "home") { model.open(WatchDestination.Home) }
        }
        null -> button("Home", "home", true) { model.open(WatchDestination.Home) }
    }
}

/** O1, centred: says why an older notification no longer applies, and that nothing changed. */
fun WatchViews.outdated(outdated: Outdated?, model: WatchViewModel) {
    center()
    if (outdated == null) {
        text("Checking…", 16f)
        return
    }
    val time = outdated.at?.let { WatchData.time(it.toString()) }
    label(
        when (outdated.reason) {
            OutdatedReason.Started -> "ALREADY STARTED"
            OutdatedReason.Stopped -> "ALREADY ANSWERED"
            OutdatedReason.Delayed -> "DELAYED"
            OutdatedReason.Moved -> "PLAN MOVED"
            OutdatedReason.Ended -> "PLAN ENDED"
        },
    )
    text(outdated.title, 23f)
    when (outdated.reason) {
        OutdatedReason.Started ->
            text("✓ It was already started on another device.", 13f, SUCCESS)
        OutdatedReason.Stopped ->
            text("✓ It was already answered on another device.", 13f, SUCCESS)
        OutdatedReason.Delayed ->
            text("It was delayed until $time. You'll get a new notification then.", 13f)
        OutdatedReason.Moved ->
            text("It now starts at $time. You'll get a new notification then.", 13f)
        OutdatedReason.Ended -> {
            text("This plan ended${time?.let { " at $it" } ?: ""}. Nothing was changed.", 13f)
            if (activityExists(outdated.activityId, model))
                button("Start ${outdated.title} now", "play") {
                    model.tracker("start", outdated.activityId)
                }
        }
    }
    button("Home", primary = true) { model.open(WatchDestination.Home) }
}

private fun activityExists(activityId: String, model: WatchViewModel) =
    model.state.value.snapshot?.activities?.any { it.id == activityId } == true
