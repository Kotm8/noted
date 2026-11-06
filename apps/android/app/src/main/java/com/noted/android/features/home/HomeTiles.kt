package com.noted.android.features.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.*
import java.time.format.DateTimeFormatter

@Composable
fun Tile(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: PaddingValues = PaddingValues(14.dp),
    content: @Composable ColumnScope.() -> Unit) {
    val colors = NotedStyle.colors
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(colors.floating).border(1.dp, colors.subtle, RoundedCornerShape(16.dp))
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(padding), content = content)
}

@Composable
private fun TileLabel(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier, color = NotedStyle.colors.muted, fontSize = 13.sp, maxLines = 1)

@Composable
fun FoodTile(repository: NativeRepository, modifier: Modifier, open: () -> Unit, logMeal: () -> Unit) {
    val colors = NotedStyle.colors
    val state = rememberResource(repository, "/nutrition")
    val today = state.obj?.text("today")?.takeIf { it.isNotBlank() } ?: LocalDate.now().toString()
    val meals = rememberResource(repository, "/nutrition/meals?start=$today&end=$today")
    val eaten = meals.rows.sumOf { meal -> meal.rows("items").sumOf { it.optInt("kcal") } }
    val target = state.obj?.optJSONObject("target")?.optInt("kcal") ?: 0
    if ((state.raw == null && state.error != null) || (meals.raw == null && meals.error != null)) {
        Tile(modifier, padding = PaddingValues(12.dp)) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically)) {
                Text("Couldn't load Nutrition", color = colors.muted, style = MaterialTheme.typography.bodySmall)
                PillButton({ repository.changed("nutrition") }) { Icon(NotedIcons.Refresh, null, Modifier.size(18.dp)); Text("Retry") }
            }
        }
        return
    }
    Tile(modifier, padding = PaddingValues(12.dp)) {
        Box(Modifier.fillMaxWidth().weight(1f).clickable(onClickLabel = "Open Nutrition", onClick = open), contentAlignment = Alignment.Center) {
            val track = colors.input
            val fill = if (target in 1 until eaten) colors.danger else colors.accent
            Canvas(Modifier.size(96.dp)) {
                val stroke = Stroke(8.dp.toPx(), cap = StrokeCap.Round)
                drawArc(track, 0f, 360f, false, style = stroke)
                if (target > 0) drawArc(fill, -90f, 360f * (eaten.toFloat() / target).coerceIn(0f, 1f), false, style = stroke)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("%,d".format(eaten), color = colors.text, fontSize = 18.sp)
                Text(if (target > 0) "of %,d".format(target) else "kcal", color = colors.muted, fontSize = 11.sp)
            }
        }
        if (target == 0) Text("Set a target on the web", color = colors.muted, fontSize = 11.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
        PillButton(logMeal, Modifier.fillMaxWidth().padding(top = 8.dp), primary = true) {
            Icon(NotedIcons.Camera, null, Modifier.size(18.dp)); Text("Log meal")
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HabitsTile(repository: NativeRepository, habits: Resource, day: String, modifier: Modifier, open: () -> Unit) {
    val colors = NotedStyle.colors
    val actions = rememberActions()
    var counting by remember { mutableStateOf<Pair<JSONObject, JSONObject?>?>(null) }
    val progress = habits.obj?.rows("progress").orEmpty().filter { it.text("day") == day }
    val due = habits.obj?.rows("habits").orEmpty().mapNotNull { habit ->
        progress.firstOrNull { it.text("habit_id") == habit.text("id") }?.takeIf { it.optBoolean("due") }?.let { habit to it }
    }
    val shown = due.sortedBy { (habit, entry) -> entry.optDouble("value") >= habit.optDouble("goal", 1.0) }.take(2)
    fun set(habit: JSONObject, entry: JSONObject?, value: Double) = actions.run {
        repository.mutate("/habits/${habit.text("id")}/progress", "PUT", json("day" to day, "value" to value, "revision" to (entry?.optInt("revision") ?: 0)))
    }
    Tile(modifier) {
        Row(Modifier.fillMaxWidth().clickable(onClickLabel = "Open Habits", onClick = open).padding(bottom = 4.dp)) {
            TileLabel("Habits", Modifier.weight(1f))
            if (due.size > shown.size) TileLabel("${due.size - shown.size} more")
        }
        shown.forEach { (habit, entry) ->
            val value = entry.optDouble("value"); val goal = habit.optDouble("goal", 1.0)
            val automatic = habit.text("activity_id").isNotBlank()
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                if (habit.text("kind") == "check") {
                    IconButton(onClick = { set(habit, entry, if (value >= goal) 0.0 else goal) }, enabled = !actions.busy && !automatic, modifier = Modifier.size(36.dp)) {
                        Icon(if (value >= goal) NotedIcons.Check else NotedIcons.Circle, if (value >= goal) "Mark ${habit.text("name")} not done" else "Mark ${habit.text("name")} done",
                            Modifier.size(20.dp), tint = if (value >= goal) colors.success else colors.muted)
                    }
                    Text(habit.text("name"), Modifier.weight(1f), fontSize = 14.sp, color = if (value >= goal) colors.muted else colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else {
                    Text("${number(value)}/${number(goal)}", Modifier.widthIn(min = 36.dp).heightIn(min = 44.dp)
                        .wrapContentHeight().combinedClickable(enabled = !automatic && !actions.busy,
                            onLongClick = { counting = habit to entry }) { set(habit, entry, value + 1) },
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (value >= goal) colors.success else colors.accent)
                    Text(habit.text("name"), Modifier.weight(1f).padding(start = 4.dp), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!automatic) Box(Modifier.size(44.dp)
                        .combinedClickable(enabled = !actions.busy, onClickLabel = "Add one to ${habit.text("name")}",
                            onLongClick = { counting = habit to entry }) { set(habit, entry, value + 1) }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(32.dp).border(1.dp, colors.border, CircleShape), contentAlignment = Alignment.Center) {
                            Icon(NotedIcons.Add, null, Modifier.size(16.dp), tint = colors.secondary)
                        }
                    }
                }
            }
        }
        if (due.isEmpty()) Text("Nothing due today", color = colors.muted, fontSize = 14.sp)
    }
    counting?.let { (habit, entry) -> com.noted.android.features.habits.HabitProgressEditor(repository, habit, entry, day) { counting = null } }
}

private fun number(value: Double) = if (value == value.toLong().toDouble()) value.toLong().toString() else "%.1f".format(value)

@Composable
fun NextUpTile(schedule: JSONObject?, timezone: String, modifier: Modifier, openCalendar: (JSONObject?) -> Unit, openTracked: () -> Unit) {
    val colors = NotedStyle.colors
    val now = Instant.now()
    val zone = ZoneId.of(timezone)
    val next = schedule?.rows("plans").orEmpty().filter { runCatching { Instant.parse(it.text("start_at")) > now }.getOrDefault(false) }
        .minByOrNull { it.text("start_at") }
    val nextToday = next?.takeIf { Instant.parse(it.text("start_at")).atZone(zone).toLocalDate() == LocalDate.now(zone) }
    Tile(modifier, padding = PaddingValues(0.dp)) {
        Column(Modifier.fillMaxWidth().clickable(onClickLabel = "Open the calendar", onClick = { openCalendar(nextToday) }).padding(14.dp)) {
            TileLabel(if (nextToday != null) "Next up · ${localTime(nextToday.text("start_at"), timezone)}" else "Next up")
            Text(nextToday?.text("title") ?: "Nothing else planned today", color = if (nextToday != null) colors.text else colors.muted,
                modifier = Modifier.padding(top = 2.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        HorizontalDivider(color = colors.subtle)
        Column(Modifier.fillMaxWidth().weight(1f).clickable(onClickLabel = "Open tracked today", onClick = openTracked).padding(14.dp)) {
            TileLabel("Tracked today")
            Text(trackedSeconds(schedule?.rows("sessions").orEmpty(), zone).let { if (it == 0L) "Nothing yet" else duration(it) }, color = colors.text, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

private fun trackedSeconds(sessions: List<JSONObject>, zone: ZoneId): Long {
    val start = LocalDate.now(zone).atStartOfDay(zone).toInstant()
    val end = start.plus(Duration.ofDays(1))
    return sessions.sumOf { session ->
        val from = runCatching { Instant.parse(session.text("started_at")) }.getOrNull() ?: return@sumOf 0L
        val until = runCatching { Instant.parse(session.text("ended_at")) }.getOrNull() ?: Instant.now()
        Duration.between(maxOf(from, start), minOf(until, end)).seconds.coerceAtLeast(0)
    }
}

fun duration(seconds: Long): String {
    val minutes = seconds / 60
    return if (minutes < 1) "under a minute" else if (minutes < 60) "$minutes min" else "${minutes / 60} h ${minutes % 60} min"
}

data class UpcomingReminder(val id: String, val revision: Int, val text: String, val due: Instant, val channelId: String)

fun upcomingReminders(schedule: JSONObject?, activity: JSONObject?): List<UpcomingReminder> {
    val board = schedule?.rows("reminders").orEmpty().mapNotNull { flag ->
        val due = runCatching { Instant.parse(flag.text("due_at")) }.getOrNull() ?: return@mapNotNull null
        UpcomingReminder(flag.text("message_id"), flag.optInt("revision", 1), flag.text("content"), due, flag.text("channel_id"))
    }
    val overdue = activity?.rows("items").orEmpty().filter { it.text("kind") == "reminder" }.mapNotNull { item ->
        val due = runCatching { Instant.parse(item.text("due_at")) }.getOrNull() ?: return@mapNotNull null
        UpcomingReminder(item.text("id"), item.optInt("revision", 1), item.text("title"), due, item.text("channel_id"))
    }
    return (overdue + board).distinctBy { it.id }.sortedBy { it.due }
}

fun reminderWhen(due: Instant, timezone: String): String {
    val zone = ZoneId.of(timezone)
    val local = due.atZone(zone)
    val today = LocalDate.now(zone)
    val time = local.format(DateTimeFormatter.ofPattern("HH:mm"))
    return when {
        due < Instant.now() -> "Overdue · $time"
        local.toLocalDate() == today -> time
        local.toLocalDate() == today.plusDays(1) -> "Tomorrow $time"
        else -> local.format(DateTimeFormatter.ofPattern("d MMM HH:mm"))
    }
}

@Composable
fun PinnedTile(repository: NativeRepository, channels: List<JSONObject>, projects: List<JSONObject>, selectedProject: String?, modifier: Modifier, open: (String) -> Unit) {
    val colors = NotedStyle.colors
    val actions = rememberActions()
    val pinned = channels.filter { it.text("pinned_at").isNotBlank() }.sortedBy { it.text("pinned_at") }
    Tile(modifier, padding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)) {
        Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(NotedIcons.PushPin, null, Modifier.size(14.dp), tint = colors.muted); TileLabel("Pinned")
        }
        if (pinned.isEmpty()) Text("Long-press any channel in the menu and choose Pin to Home to keep it here.", color = colors.secondary,
            fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp))
        pinned.forEachIndexed { index, channel ->
            if (index > 0) HorizontalDivider(color = colors.subtle)
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { open(channelRoute(channel.text("id"))) },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(channelIcon(channel.text("kind")), null, Modifier.size(20.dp), tint = colors.muted)
                Column(Modifier.weight(1f)) {
                    Text(channel.text("name"), color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val latest = pinnedExcerpt(repository, channel)
                    if (latest.isNotBlank()) Text(latest, color = colors.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (channel.text("workspace_id") != selectedProject) Text(projects.firstOrNull { it.text("id") == channel.text("workspace_id") }?.text("name").orEmpty(),
                    Modifier.widthIn(max = 90.dp), color = colors.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (channel.text("kind") == "journal") IconButton(onClick = { actions.run {
                    val entry = JSONObject(repository.mutate("/channels/${channel.text("id")}/journal", body = json("title" to LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE d MMMM")))))
                    open(channelRoute(channel.text("id"), ChannelLocation(entry = entry.text("id"))))
                } }, enabled = !actions.busy) { Icon(NotedIcons.Add, "New entry in ${channel.text("name")}", Modifier.size(20.dp)) }
            }
        }
    }
}

@Composable
private fun pinnedExcerpt(repository: NativeRepository, channel: JSONObject): String {
    val id = channel.text("id")
    val text = when (channel.text("kind")) {
        "journal" -> rememberResource(repository, "/channels/$id/journal?limit=1&offset=0").rows.firstOrNull()?.text("title")
        "document" -> null
        else -> rememberResource(repository, "/channels/$id/messages?limit=1").obj?.rows("items")?.lastOrNull()?.text("content")
    }.orEmpty().lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
    return com.noted.android.features.search.readableExcerpt(text)
}

@Composable
fun channelIcon(kind: String) = when (kind) {
    "journal" -> NotedIcons.MenuBook; "document" -> NotedIcons.Description
    "reminder" -> NotedIcons.Notifications; "tasks" -> NotedIcons.CheckBox; else -> NotedIcons.Tag
}
