package com.noted.android.features.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * The tracker as Home's first tile. Tapping it unrolls the activity list in place instead of opening
 * a picker, so starting or switching never leaves Home (phone home story 7).
 */
@Composable
fun TrackerTile(repository: NativeRepository, expanded: Boolean, setExpanded: (Boolean) -> Unit, timezone: String,
    manageActivities: () -> Unit) {
    val colors = NotedStyle.colors
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val activities = rememberResource(repository, "/time-tracking/activities")
    val prompts = rememberResource(repository, "/schedule/prompts")
    val actions = rememberActions()
    val state = tracker.obj
    val active = state?.optJSONObject("active")
    val pausedId = state?.text("paused_activity_id").orEmpty()
    val activity = activities.rows.firstOrNull { it.text("id") == (active?.text("activity_id") ?: pausedId) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state?.text("server_time"), active?.text("id")) {
        now = System.currentTimeMillis()
        while (active != null) { delay(1000); now = System.currentTimeMillis() }
    }
    val started = active?.let { runCatching { Instant.parse(it.text("started_at")) }.getOrNull() }
    val sampledAt = remember(state?.text("server_time")) {
        runCatching { Instant.parse(state?.text("server_time")).toEpochMilli() }.getOrElse { System.currentTimeMillis() }
    }
    val seconds = (state?.optLong("elapsed_seconds") ?: 0L) + if (active != null) ((now - sampledAt) / 1000).coerceAtLeast(0) else 0
    fun act(action: String, activityId: String? = null) {
        if (state == null) return
        actions.run { repository.mutate("/time-tracking/tracker", body = json("action" to action,
            "revision" to state.optInt("revision"), "activity_id" to activityId, "request_id" to UUID.randomUUID().toString())) }
    }
    val tint = activity?.let { color(it.text("color")) }
    val background = if (tint != null) lerp(colors.floating, tint, .1f) else colors.floating
    val edge = if (tint != null) lerp(colors.subtle, tint, .3f) else colors.subtle
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(background).border(1.dp, edge, RoundedCornerShape(16.dp))) {
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (expanded) "Hide activities" else "Choose an activity") {
            setExpanded(!expanded)
        }.padding(start = 16.dp, end = 10.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                when {
                    active != null -> {
                        Text(activity?.text("name") ?: "Tracking", color = tint ?: colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(clockDuration(seconds), color = colors.text, fontSize = 36.sp, fontWeight = FontWeight.Light, lineHeight = 40.sp)
                        Text("Since ${localTime(active.text("started_at"), timezone)}", color = colors.muted, fontSize = 13.sp)
                    }
                    pausedId.isNotBlank() -> {
                        Text("${activity?.text("name") ?: "Activity"} paused", color = tint ?: colors.secondary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(clockDuration(seconds), color = colors.text, fontSize = 36.sp, fontWeight = FontWeight.Light, lineHeight = 40.sp)
                        Text("Paused", color = colors.muted, fontSize = 13.sp)
                    }
                    else -> {
                        Text("Not tracking", color = colors.muted, fontSize = 13.sp)
                        Text("Choose an activity", color = colors.text, fontSize = 20.sp, modifier = Modifier.padding(top = 2.dp))
                    }
                }
            }
            when {
                active != null -> {
                    RoundAction(NotedIcons.Pause, "Pause", !actions.busy) { act("pause") }
                    RoundAction(NotedIcons.Stop, "Stop", !actions.busy) { act("stop") }
                }
                pausedId.isNotBlank() -> {
                    RoundAction(NotedIcons.Play, "Resume", !actions.busy) { act("resume") }
                    RoundAction(NotedIcons.Stop, "Stop", !actions.busy) { act("stop") }
                }
                else -> PillButton(onClick = { setExpanded(true) }, primary = true) {
                    Icon(NotedIcons.Play, null, Modifier.size(18.dp)); Text("Start")
                }
            }
        }
        prompts.rows.firstOrNull()?.let { prompt -> PlanPrompt(repository, prompt, activities.rows, edge, timezone) }
        AnimatedVisibility(expanded, enter = expandVertically(), exit = shrinkVertically()) {
            Column {
                activities.rows.filter { !it.optBoolean("archived") }.forEach { item ->
                    val running = item.text("id") == active?.text("activity_id")
                    HorizontalDivider(color = edge)
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(enabled = !actions.busy && !running) {
                        act("start", item.text("id")); setExpanded(false)
                    }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(Modifier.size(12.dp).background(color(item.text("color")), CircleShape))
                        Text(item.text("name"), Modifier.weight(1f), color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (running) {
                            Text("Running", color = colors.muted, fontSize = 13.sp)
                            Icon(NotedIcons.Check, null, Modifier.size(18.dp), tint = color(item.text("color")))
                        }
                    }
                }
                HorizontalDivider(color = edge)
                NotedTextButton(manageActivities, Modifier.fillMaxWidth().padding(4.dp)) { Text("Manage activities") }
            }
        }
    }
}

@Composable
private fun RoundAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, action: () -> Unit) {
    IconButton(onClick = action, enabled = enabled, modifier = Modifier.size(44.dp).background(NotedStyle.colors.input, CircleShape)) {
        Icon(icon, label, Modifier.size(20.dp), tint = NotedStyle.colors.text)
    }
}

fun clockDuration(seconds: Long) = "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)

/** The due-plan band at the bottom of the tracker tile, and its Delay sheet (phone home story 8). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlanPrompt(repository: NativeRepository, prompt: JSONObject, activities: List<JSONObject>, edge: Color, timezone: String) {
    val colors = NotedStyle.colors
    var delayOpen by remember(prompt.text("id")) { mutableStateOf(false) }
    val actions = rememberActions()
    val ended = prompt.text("phase") == "end"
    val tint = activities.firstOrNull { it.text("id") == prompt.text("activity_id") }?.let { color(it.text("color")) } ?: colors.accent
    val window = listOf(prompt.text("planned_start"), prompt.text("planned_end")).filter { it.isNotBlank() }
        .joinToString(" – ") { localTime(it, timezone) }
    HorizontalDivider(color = edge)
    Column(Modifier.fillMaxWidth().background(lerp(colors.floating, tint, .1f)).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(10.dp).background(tint, CircleShape))
            Text(if (ended) "${prompt.text("title")} has ended" else "${prompt.text("title")} starts now", color = colors.text)
        }
        if (window.isNotBlank()) Text("Plan · $window", Modifier.padding(start = 18.dp), color = colors.muted, fontSize = 13.sp)
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PillButton({ actions.run {
                repository.mutate("/schedule/prompts/${prompt.text("id")}/actions", body = json(
                    "action" to if (ended) "stop" else "start", "revision" to prompt.optInt("revision"),
                    "request_id" to UUID.randomUUID().toString()))
                repository.changed()
            } }, Modifier.weight(1f), primary = true, enabled = !actions.busy) { Text(if (ended) "Stop" else "Start") }
            PillButton({ delayOpen = true }, Modifier.weight(1f), enabled = !actions.busy) { Text("Delay") }
        }
    }
    if (delayOpen) {
        val reasons = listOf("Finishing the current task", "Taking a break", "Not feeling well", "Something came up")
        val lengths = listOf(5 to "5 min", 15 to "15 min", 30 to "30 min", 60 to "1 hour")
        var reason by remember { mutableStateOf(reasons.first()) }
        var minutes by remember { mutableIntStateOf(15) }
        DesignSheet({ delayOpen = false }, "Delay ${prompt.text("title")}") {
            DesignLabel("Why?")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                reasons.forEach { PillChip(it, reason == it, { reason = it }) }
            }
            DesignLabel("For how long?")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                lengths.forEach { (value, label) -> PillChip(label, minutes == value, { minutes = value }) }
            }
            PillButton({ actions.run {
                repository.mutate("/schedule/prompts/${prompt.text("id")}/actions", body = json(
                    "action" to "delay", "revision" to prompt.optInt("revision"), "minutes" to minutes, "reason" to reason,
                    "requested_at" to Instant.now().toString(), "request_id" to UUID.randomUUID().toString()))
                repository.changed()
                delayOpen = false
            } }, Modifier.fillMaxWidth().padding(top = 22.dp), primary = true, enabled = !actions.busy) {
                Text("Delay ${lengths.first { it.first == minutes }.second}")
            }
        }
    }
}
