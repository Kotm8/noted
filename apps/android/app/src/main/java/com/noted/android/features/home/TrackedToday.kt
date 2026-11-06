package com.noted.android.features.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.*

private data class TrackedSession(val session: JSONObject, val from: ZonedDateTime, val until: ZonedDateTime?, val seconds: Long)

/** Today's sessions with a running total, so a forgotten stop can be fixed from the phone. */
@Composable
fun TrackedToday(repository: NativeRepository, sessions: List<JSONObject>, activities: List<JSONObject>, timezone: String) {
    val zone = ZoneId.of(timezone)
    val dayStart = LocalDate.now(zone).atStartOfDay(zone)
    val dayEnd = dayStart.plusDays(1)
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    val tracked = sessions.mapNotNull { session ->
        val from = runCatching { Instant.parse(session.text("started_at")).atZone(zone) }.getOrNull() ?: return@mapNotNull null
        val until = runCatching { Instant.parse(session.text("ended_at")).atZone(zone) }.getOrNull()
        val start = maxOf(from, dayStart)
        val end = minOf(until ?: ZonedDateTime.now(zone), dayEnd)
        if (end <= start) null else TrackedSession(session, from, until, Duration.between(start, end).seconds)
    }.sortedBy { it.from }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Tracked today", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            if (tracked.isNotEmpty()) Text(duration(tracked.sumOf { it.seconds }), color = NotedStyle.colors.secondary)
        }
        if (tracked.isEmpty()) Text("Nothing tracked yet today.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        tracked.forEach { item ->
            val activity = activities.firstOrNull { it.text("id") == item.session.text("activity_id") }
            val running = item.until == null
            NotedListItem(headlineContent = { Text(activity?.text("name") ?: "Activity") },
                supportingContent = { Text("${clock(item.from)} - ${item.until?.let(::clock) ?: "now"}") },
                leadingContent = { Icon(NotedIcons.Circle, null, Modifier.size(12.dp), tint = color(activity?.text("color").orEmpty())) },
                trailingContent = { Text(duration(item.seconds), color = NotedStyle.colors.secondary) },
                modifier = Modifier.clickable(enabled = !running) { editing = item.session })
        }
    }
    editing?.let { SessionEditor(repository, it, activities, zone) { editing = null } }
}

@Composable
private fun SessionEditor(repository: NativeRepository, session: JSONObject, activities: List<JSONObject>, zone: ZoneId, close: () -> Unit) {
    val from = Instant.parse(session.text("started_at")).atZone(zone)
    val until = Instant.parse(session.text("ended_at")).atZone(zone)
    val day = from.toLocalDate()
    var activity by remember { mutableStateOf(session.text("activity_id")) }
    var start by remember { mutableIntStateOf(from.hour * 60 + from.minute) }
    var end by remember { mutableIntStateOf(if (until.toLocalDate() == day) until.hour * 60 + until.minute else 1440) }
    var deleting by remember { mutableStateOf(false) }
    val id = session.text("id")
    if (deleting) {
        ConfirmDelete("Delete this session?", { deleting = false }) {
            repository.mutate("/time-tracking/sessions/$id?revision=${session.optInt("revision")}", "DELETE"); close()
        }
        return
    }
    EditorSheet("Tracked session", close, enabled = activity.isNotBlank(), save = {
        require(end > start) { "End time must follow start time." }
        fun at(minute: Int) = day.atStartOfDay(zone).plusMinutes(minute.toLong()).toOffsetDateTime().toString()
        repository.mutate("/time-tracking/sessions/$id", "PUT", json("activity_id" to activity, "started_at" to at(start),
            "ended_at" to at(end), "revision" to session.optInt("revision")))
        close()
    }) {
        Choice("Activity", activity, activities.filter { !it.optBoolean("archived") || it.text("id") == activity }
            .map { it.text("id") to it.text("name") }) { activity = it }
        TimeField("Started", start) { start = it }
        TimeField("Ended", end) { end = it }
        NotedTextButton(onClick = { deleting = true }) { Text("Delete session", color = MaterialTheme.colorScheme.error) }
    }
}

private fun clock(time: ZonedDateTime) = "%02d:%02d".format(time.hour, time.minute)

private fun duration(seconds: Long): String {
    val minutes = seconds / 60
    return if (minutes < 1) "under a minute" else if (minutes < 60) "$minutes min" else "${minutes / 60} h ${minutes % 60} min"
}
