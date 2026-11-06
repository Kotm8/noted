package com.noted.android.features.tracker

import androidx.compose.foundation.background
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
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Composable
fun TrackerBar(repository: NativeRepository, expanded: Boolean, toggle: () -> Unit, settings: () -> Unit) {
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val activities = rememberResource(repository, "/time-tracking/activities")
    val prompts = rememberResource(repository, "/schedule/prompts")
    val actions = rememberActions()
    val state = tracker.obj
    val active = state?.optJSONObject("active")
    val activity = activities.rows.firstOrNull { it.text("id") == active?.text("activity_id") }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(active?.text("id")) {
        while (true) { delay(1000); now = System.currentTimeMillis() }
    }
    val seconds = if (active == null) 0 else runCatching {
        Duration.between(Instant.parse(active.text("started_at")), Instant.ofEpochMilli(now)).seconds.coerceAtLeast(0)
    }.getOrDefault(0)
    fun act(action: String, activityId: String? = null) {
        if (state == null) return
        actions.run { repository.mutate("/time-tracking/tracker", body = json("action" to action,
            "revision" to state.optInt("revision"), "activity_id" to activityId, "request_id" to UUID.randomUUID().toString())) }
    }
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.navigationBarsPadding()) {
            if (expanded) {
                ResourceStatus(tracker) { repository.changed() }
                val prompt = prompts.rows.firstOrNull()
                if (prompt != null) PlanPrompt(repository, prompt, activities.rows)
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 240.dp), contentPadding = PaddingValues(horizontal = 12.dp)) {
                    items(activities.rows.filter { !it.optBoolean("archived") }, key = { it.text("id") }) { item ->
                        NotedListItem(headlineContent = { Text(item.text("name")) },
                            leadingContent = { Icon(NotedIcons.Circle, null, Modifier.size(14.dp), tint = color(item.text("color"))) },
                            trailingContent = { if (item.text("id") == active?.text("activity_id")) Icon(NotedIcons.Check, null) },
                            modifier = Modifier.clickable(enabled = !actions.busy) { act("start", item.text("id")) })
                    }
                    item { NotedTextButton(onClick = settings, modifier = Modifier.fillMaxWidth()) { Text("Manage activities") } }
                }
                if (active != null) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    NotedOutlinedButton(onClick = { act("pause") }, enabled = !actions.busy, modifier = Modifier.weight(1f)) {
                        Icon(NotedIcons.Pause, null); Text("Pause")
                    }
                    NotedOutlinedButton(onClick = { act("stop") }, enabled = !actions.busy, modifier = Modifier.weight(1f)) {
                        Icon(NotedIcons.Stop, null); Text("Stop")
                    }
                }
                if (state?.text("paused_activity_id").orEmpty().isNotBlank()) NotedTextButton(onClick = { act("resume") }, enabled = !actions.busy) { Text("Resume paused activity") }
            }
            Row(Modifier.fillMaxWidth().height(64.dp).clickable(onClick = toggle).padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (active != null) NotedIcons.PlayCircle else NotedIcons.Timer, null,
                    tint = activity?.let { color(it.text("color")) } ?: MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text(activity?.text("name") ?: "Choose an activity", style = MaterialTheme.typography.titleSmall)
                    if (active != null) Text("%02d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60),
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else Text("${if (state?.text("paused_activity_id").orEmpty().isNotBlank()) "Paused" else "Nothing tracking"}",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (prompts.rows.isNotEmpty()) Icon(NotedIcons.NotificationsActive, "Activity needs attention", tint = MaterialTheme.colorScheme.primary)
                Icon(if (expanded) NotedIcons.ExpandMore else NotedIcons.ExpandLess, null)
            }
        }
    }
}

@Composable
private fun PlanPrompt(repository: NativeRepository, prompt: JSONObject, activities: List<JSONObject>) {
    var delayOpen by remember(prompt.text("id")) { mutableStateOf(false) }
    val actions = rememberActions()
    val ended = prompt.text("phase") == "end"
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (ended) "${prompt.text("title")} has ended" else "Time for ${prompt.text("title")}", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NotedButton(onClick = { actions.run {
                repository.mutate("/schedule/prompts/${prompt.text("id")}/actions", body = json(
                    "action" to if (ended) "stop" else "start", "revision" to prompt.optInt("revision"),
                    "request_id" to UUID.randomUUID().toString()))
            } }, enabled = !actions.busy) { Text(if (ended) "No activity" else "Start activity") }
            NotedOutlinedButton(onClick = { delayOpen = true }) { Icon(NotedIcons.Snooze, null, Modifier.size(18.dp)); Text("Snooze") }
        }
    }
    if (delayOpen) {
        var minutes by remember { mutableIntStateOf(5) }
        var reason by remember { mutableStateOf("Finishing up current task") }
        var other by remember { mutableStateOf("") }
        EditorSheet("Snooze activity prompt", { delayOpen = false }, confirm = "Snooze", save = {
            require(reason.isNotBlank()) { "Choose a reason." }
            repository.mutate("/schedule/prompts/${prompt.text("id")}/actions", body = json(
                "action" to if (other.isBlank()) "delay" else "other", "revision" to prompt.optInt("revision"),
                "minutes" to minutes, "reason" to reason, "activity_id" to other.takeIf { it.isNotBlank() },
                "requested_at" to Instant.now().toString(), "request_id" to UUID.randomUUID().toString()))
        }) {
            Choice("Remind me in", minutes, listOf(5, 10, 15, 30, 60).map { it to "$it minutes" }) { minutes = it }
            Choice("Reason", reason, listOf("Finishing up current task", "Taking a break", "Something came up").map { it to it }) { reason = it }
            Field("Reason", reason, { reason = it })
            Choice("Track another activity", other, listOf("" to "Keep current activity") + activities.map { it.text("id") to it.text("name") }) { other = it }
            Text("The planned block stays at its original time.", style = MaterialTheme.typography.bodySmall)
        }
    }
}
