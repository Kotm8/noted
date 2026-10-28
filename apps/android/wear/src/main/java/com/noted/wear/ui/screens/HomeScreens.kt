package com.noted.wear.ui.screens

import android.graphics.Color
import android.graphics.Typeface
import android.widget.TextView
import com.noted.wear.data.Snapshot
import com.noted.wear.data.WatchData
import com.noted.wear.navigation.WatchDestination
import com.noted.wear.ui.UpcomingItem
import com.noted.wear.ui.WatchUiState
import com.noted.wear.ui.WatchViewModel
import com.noted.wear.ui.MUTED
import com.noted.wear.ui.WatchViews

/**
 * B01: what you're doing fills the top of the screen, with Switch and Pause
 * right under it and the next plan as one line. The rest scrolls below.
 * Returns the elapsed-time view so the activity can tick it every second.
 */
fun WatchViews.home(state: WatchUiState, model: WatchViewModel): TextView? {
    val snapshot = state.snapshot ?: return null
    state.notice?.let { text(it, 11f, Color.LTGRAY) }
    val current = snapshot.current
    val running = snapshot.tracker.running
    centerText(true)
    icon(current?.icon ?: "idle", if (current != null) accent else MUTED)
    label(
        when {
            current == null -> "NOTHING TRACKED"
            running -> "TRACKING"
            else -> "PAUSED"
        },
    )
    text(current?.name ?: "Not tracking", 19f)
    val elapsed =
        text(
            if (current == null) "Choose an activity to start"
            else WatchData.duration(snapshot.tracker.elapsed()),
            if (current == null) 12f else 24f,
            if (current == null) MUTED else accent,
        )
    if (current != null) elapsed.typeface = Typeface.create("monospace", Typeface.NORMAL)
    if (current == null)
        pillRow("Start", "play", { model.open(WatchDestination.Activities) })
    else
        pillRow(
            "Switch",
            "swap",
            { model.open(WatchDestination.Activities) },
            (if (running) "pause" else "play") to (if (running) "Pause" else "Resume"),
        ) {
            model.tracker(if (running) "pause" else "resume")
        }
    val upcoming = UpcomingItem.from(snapshot)
    upcoming.firstOrNull()?.let { next ->
        upcoming(next, model)
    }
    centerText(false)
    if (upcoming.size > 1) {
        divider()
        label("LATER")
        upcoming.drop(1).take(3).forEach { upcoming(it, model) }
    }
    if (upcoming.size > 4) button("More upcoming") { model.open(WatchDestination.Upcoming) }
    button("Watch settings") { model.open(WatchDestination.Settings) }
    return if (current != null) elapsed else null
}

fun WatchViews.upcomingList(snapshot: Snapshot, model: WatchViewModel) {
    text("Upcoming", 21f)
    UpcomingItem.from(snapshot).forEach { upcoming(it, model) }
}

private fun WatchViews.upcoming(item: UpcomingItem, model: WatchViewModel) {
    button(item.title, if (item.kind == "plan") "next" else "flag", false, item.subtitle) {
        model.open(item.destination)
    }
}

/** The activity list; with [promptId] it picks what to do instead of a prompted plan. */
fun WatchViews.activities(snapshot: Snapshot, model: WatchViewModel, promptId: String? = null) {
    text(if (promptId != null) "Another activity" else "Activities", 18f)
    val favorites = snapshot.preferences.favorites
    snapshot.activities
        .sortedBy { if (it.id in favorites) 0 else 1 }
        .forEach { activity ->
            val active = activity.id == snapshot.tracker.activeActivityId
            button(
                activity.name,
                activity.icon,
                false,
                if (active && promptId == null) "Running now" else "",
            ) {
                if (promptId != null) model.open(WatchDestination.Delay(promptId, activity.id))
                else model.tracker("start", activity.id)
            }
        }
    if (promptId == null) {
        val running = snapshot.tracker.running
        button(if (running) "Pause" else "Resume", if (running) "pause" else "play") {
            model.tracker(if (running) "pause" else "resume")
        }
        button("Stop") { model.tracker("stop") }
    }
}
