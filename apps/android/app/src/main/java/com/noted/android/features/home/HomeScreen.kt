package com.noted.android.features.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.features.calendar.schedulePath
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Home as a grid of tiles (design C). Each tile answers one question and has one action that works
 * without leaving Home; tiles for features that are off or empty are left out rather than shown blank.
 * The behaviour is specified in docs/design/phone/home-tiles-stories.md.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(repository: NativeRepository, channels: List<JSONObject>, projects: List<JSONObject>, open: (String) -> Unit,
    logMeal: () -> Unit, trackerExpanded: Boolean, selectedProject: String?, setTrackerExpanded: (Boolean) -> Unit) {
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val timezone = tracker.obj?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    val today = LocalDate.now(ZoneId.of(timezone))
    val schedule = rememberResource(repository, schedulePath(today, today.plusDays(2), timezone))
    val activity = rememberResource(repository, "/home/activity")
    val activities = rememberResource(repository, "/time-tracking/activities")
    val habits = rememberResource(repository, "/habits?start=$today&end=$today")
    val ai = rememberResource(repository, "/ai/status")
    val aiPreferences = rememberResource(repository, if (ai.obj?.optBoolean("connected") == true) "/ai/preferences" else null)
    val nutrition = ai.obj?.optBoolean("connected") == true && aiPreferences.obj?.opt("nutrition") != false
    var trackedOpen by remember { mutableStateOf(false) }
    val reminders = upcomingReminders(schedule.obj, activity.obj)
    val offline = listOf(tracker, schedule).any { it.error != null && it.raw != null }
    var savedAt by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(offline, tracker.raw, schedule.raw) {
        if (offline) savedAt = listOfNotNull(repository.cachedAt("/time-tracking/tracker"),
            repository.cachedAt(schedulePath(today, today.plusDays(2), timezone))).minOrNull()
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (offline) Text(savedAt?.let { "Offline · showing data from ${Instant.ofEpochMilli(it).atZone(ZoneId.of(timezone)).format(DateTimeFormatter.ofPattern("HH:mm"))}" }
            ?: "Offline · showing saved data", Modifier.fillMaxWidth(), color = NotedStyle.colors.muted,
            style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        TrackerTile(repository, trackerExpanded, setTrackerExpanded, timezone) { open("settings/activities") }
        val half = buildList<@Composable (Modifier) -> Unit> {
            if (nutrition) add { FoodTile(repository, it, { open("nutrition") }, logMeal) }
            if (habits.obj?.rows("habits").orEmpty().isNotEmpty()) add { HabitsTile(repository, habits, today.toString(), it) { open("habits") } }
            add { NextUpTile(schedule.obj, timezone, it, { plan ->
                open(if (plan == null) "calendar" else "calendar?plan=${plan.text("id")}&date=${plan.text("occurrence_date")}")
            }) { trackedOpen = true } }
            add { ReminderTile(repository, reminders, channels, timezone, it, open) }
        }
        half.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { tile -> tile(Modifier.weight(1f).fillMaxHeight().heightIn(min = 150.dp)) }
            }
        }
        PinnedTile(repository, channels, projects, selectedProject, Modifier.fillMaxWidth(), open)
    }
    if (trackedOpen) DesignSheet({ trackedOpen = false }, "Tracked today") {
        TrackedToday(repository, schedule.obj?.rows("sessions").orEmpty(), activities.rows, timezone)
    }
}

fun greeting(hour: Int = java.time.LocalTime.now().hour) = when (hour) {
    in 5..11 -> "Good morning"; in 12..17 -> "Good afternoon"; else -> "Good evening"
}

fun localTime(iso: String, timezone: String = ZoneId.systemDefault().id): String = runCatching {
    Instant.parse(iso).atZone(ZoneId.of(timezone)).format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("")
