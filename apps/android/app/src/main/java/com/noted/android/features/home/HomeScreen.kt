package com.noted.android.features.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import com.noted.android.features.calendar.schedulePath
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun HomeScreen(repository: NativeRepository, channels: List<JSONObject>, projects: List<JSONObject>, open: (String) -> Unit) {
    val resource = rememberResource(repository, "/home/activity")
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val timezone = tracker.obj?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    val today = LocalDate.now(ZoneId.of(timezone))
    val schedule = rememberResource(repository, schedulePath(today, today.plusDays(2), timezone))
    val activities = rememberResource(repository, "/time-tracking/activities")
    val actions = rememberActions()
    val events = resource.obj?.rows("items").orEmpty()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Text(today.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Today", Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.headlineSmall)
            ResourceStatus(resource) { repository.changed() }
        }
        item { Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Next up", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            NotedTextButton(onClick = { open("calendar") }) { Text("Calendar"); Icon(NotedIcons.ChevronRight, null) }
        } }
        val next = schedule.obj?.rows("plans").orEmpty().filter {
            runCatching { Instant.parse(it.text("end_at")) > Instant.now() }.getOrDefault(false)
        }.sortedBy { it.text("start_at") }.take(3)
        items(next, key = { "plan-${it.text("id")}-${it.text("occurrence_date")}" }) { plan ->
            Surface(onClick = { open("calendar") }, shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainer) {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Icon(NotedIcons.Schedule, null, tint = MaterialTheme.colorScheme.primary)
                    Column { Text(plan.text("title")); Text(
                        "${localTime(plan.text("start_at"), timezone)} - ${localTime(plan.text("end_at"), timezone)}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        if (next.isEmpty()) item { Text("Nothing planned next.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        item { TrackedToday(repository, schedule.obj?.rows("sessions").orEmpty(), activities.rows, timezone) }
        if (channels.any { it.text("pinned_at").isNotBlank() }) {
            item { SectionTitle("Pinned channels") }
            items(channels.filter { it.text("pinned_at").isNotBlank() }, key = { "pin-${it.text("id")}" }) { channel ->
                NotedListItem(headlineContent = { Text(channel.text("name")) }, leadingContent = { Icon(NotedIcons.PushPin, null) },
                    supportingContent = { Text(projects.firstOrNull { it.text("id") == channel.text("workspace_id") }?.text("name").orEmpty()) },
                    modifier = Modifier.clickable { open("channel/${channel.text("id")}") })
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Notifications", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                if (events.any { !it.optBoolean("read") }) NotedTextButton(enabled = !actions.busy, onClick = {
                    actions.run {
                        repository.mutate("/home/activity/read", body = json("items" to JSONArray(events.filter { !it.optBoolean("read") }
                            .map { json("kind" to it.text("kind"), "id" to it.text("id"), "revision" to it.optInt("revision")) })))
                    }
                }) { Text("Mark read") }
            }
        }
        items(events, key = { "${it.text("kind")}-${it.text("id")}" }) { event ->
            NotedListItem(headlineContent = { Text(event.text("title")) }, supportingContent = {
                Text(listOf(event.text("workspace_name"), event.text("channel_name"), localTime(event.text("due_at"), timezone))
                    .filter { it.isNotBlank() }.joinToString(" · "))
            }, leadingContent = { Icon(if (event.optBoolean("read")) NotedIcons.NotificationsNone else NotedIcons.Notifications, null,
                tint = if (event.optBoolean("read")) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary) },
                modifier = Modifier.clickable {
                    when {
                        event.text("channel_id").isNotBlank() -> open("channel/${event.text("channel_id")}")
                        event.text("kind") == "habit" -> open("habits")
                        else -> open("calendar")
                    }
                })
        }
        if (events.isEmpty()) item { Text("You're caught up.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

fun localTime(iso: String, timezone: String = ZoneId.systemDefault().id): String = runCatching {
    Instant.parse(iso).atZone(ZoneId.of(timezone)).format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("")
