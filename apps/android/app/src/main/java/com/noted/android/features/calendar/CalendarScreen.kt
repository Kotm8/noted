package com.noted.android.features.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.*
import java.time.format.DateTimeFormatter

@Composable
fun CalendarScreen(repository: NativeRepository) {
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val activities = rememberResource(repository, "/time-tracking/activities")
    val preferences = tracker.obj?.optJSONObject("preferences")
    val timezone = preferences?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    var anchor by rememberSaveable { mutableStateOf(LocalDate.now(ZoneId.of(timezone)).toString()) }
    val first = LocalDate.parse(anchor).minusDays(3)
    val days = (0L..16L).map { first.plusDays(it) }
    val board = rememberResource(repository, schedulePath(first, first.plusDays(17), timezone))
    val start = preferences?.optInt("start_minute", 480) ?: 480
    val end = preferences?.optInt("end_minute", 1380) ?: 1380
    val scale = 2f
    val width = ((end - start) * scale).dp
    val scroll = rememberScrollState()
    val vertical = rememberScrollState()
    var details by remember { mutableStateOf<JSONObject?>(null) }
    val context = LocalContext.current
    val origin = repository.session.collectAsState().value?.origin
    val density = LocalDensity.current
    LaunchedEffect(anchor) { vertical.scrollTo(with(density) { (136.dp * 3).roundToPx() }) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { DateField("Go to", LocalDate.parse(anchor)) { anchor = it.toString() } }
            NotedTextButton(onClick = { anchor = LocalDate.now(ZoneId.of(timezone)).toString() }) { Text("Today") }
            if (origin != null) ActionIcon(NotedIcons.ExternalLink, "Edit the calendar on the web") { openOnWeb(context, origin, "/schedule") }
        }
        ResourceStatus(board) { repository.changed() }
        Row(Modifier.fillMaxWidth().padding(start = 94.dp).horizontalScroll(scroll)) {
            Box(Modifier.width(width).height(30.dp)) {
                for (minute in (start / 60 * 60)..end step 60) if (minute >= start) Text(minuteLabel(minute),
                    Modifier.offset(x = ((minute - start) * scale).dp), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(vertical)) {
            days.forEach { day ->
                val off = dayOff(day, preferences?.optJSONObject("work_schedule"))
                Row(Modifier.fillMaxWidth().height(136.dp).background(if (off) MaterialTheme.colorScheme.onSurface.copy(alpha = .035f) else MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.width(94.dp).padding(start = 12.dp, top = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(day.format(DateTimeFormatter.ofPattern("EEE d")), style = MaterialTheme.typography.titleSmall,
                            color = if (day == LocalDate.now(ZoneId.of(timezone))) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                        Text(if (off) "Day off" else "Workday", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(Modifier.horizontalScroll(scroll)) {
                        Box(Modifier.width(width).height(66.dp)) {
                            for (minute in (start / 60 * 60)..end step 60) if (minute >= start) Box(Modifier.offset(x = ((minute - start) * scale).dp)
                                .width(1.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outline.copy(alpha = .3f)))
                            board.obj?.rows("plans").orEmpty().filter { it.text("occurrence_date") == day.toString() }.forEach { plan ->
                                val left = (plan.optInt("start_minute") - start).coerceAtLeast(0)
                                val right = (plan.optInt("end_minute").coerceAtMost(end) - start).coerceAtLeast(left)
                                val activity = activities.rows.firstOrNull { it.text("id") == plan.text("activity_id") }
                                if (right > left) Surface(onClick = { details = plan },
                                    modifier = Modifier.offset(x = (left * scale).dp, y = 6.dp).width(((right - left) * scale).dp).height(54.dp),
                                    color = color(activity?.text("color").orEmpty()).copy(alpha = .17f), shape = RoundedCornerShape(5.dp)) {
                                    Column(Modifier.padding(8.dp)) {
                                        Text(plan.text("title"), maxLines = 1, style = MaterialTheme.typography.labelLarge)
                                        Text("${minuteLabel(plan.optInt("start_minute"))} - ${minuteLabel(plan.optInt("end_minute"))}${if (plan.text("frequency") != "none") " · Repeats" else ""}",
                                            maxLines = 1, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                        Box(Modifier.width(width).height(38.dp)) {
                            board.obj?.rows("sessions").orEmpty().forEach { session ->
                                val from = runCatching { Instant.parse(session.text("started_at")).atZone(ZoneId.of(timezone)) }.getOrNull()
                                val until = runCatching { Instant.parse(session.text("ended_at")).atZone(ZoneId.of(timezone)) }.getOrNull() ?: ZonedDateTime.now(ZoneId.of(timezone))
                                if (from != null && !day.isBefore(from.toLocalDate()) && !day.isAfter(until.toLocalDate())) {
                                    val left = ((if (from.toLocalDate() == day) from.hour * 60 + from.minute else 0) - start).coerceAtLeast(0)
                                    val right = ((if (until.toLocalDate() == day) until.hour * 60 + until.minute else 1440).coerceAtMost(end) - start).coerceAtLeast(left)
                                    val activity = activities.rows.firstOrNull { it.text("id") == session.text("activity_id") }
                                    if (right > left) Box(Modifier.offset(x = (left * scale).dp).width(((right - left) * scale).dp).height(30.dp)
                                        .background(color(activity?.text("color").orEmpty()).copy(alpha = .4f), RoundedCornerShape(4.dp)).padding(6.dp)) {
                                        Text(activity?.text("name").orEmpty(), maxLines = 1, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                        Row(Modifier.width(width).height(25.dp)) {
                            board.obj?.rows("reminders").orEmpty().filter {
                                runCatching { Instant.parse(it.text("due_at")).atZone(ZoneId.of(timezone)).toLocalDate() == day }.getOrDefault(false)
                            }.take(3).forEach { reminder ->
                                Icon(NotedIcons.Flag, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                                Text(reminder.text("content").take(45), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .4f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                NotedTextButton(onClick = { anchor = LocalDate.parse(anchor).minusDays(14).toString() }) { Text("Earlier days") }
                NotedTextButton(onClick = { anchor = LocalDate.parse(anchor).plusDays(14).toString() }) { Text("More days") }
            }
        }
    }
    details?.let { plan -> PlanDetails(plan, activities.rows.firstOrNull { it.text("id") == plan.text("activity_id") },
        { details = null }) { origin?.let { openOnWeb(context, it, "/schedule") } } }
}

/** The phone shows plans without editing them; changes happen in the web calendar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanDetails(plan: JSONObject, activity: JSONObject?, close: () -> Unit, editOnWeb: () -> Unit) {
    NotedSheet(onDismissRequest = close, title = plan.text("title")) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val day = runCatching { LocalDate.parse(plan.text("occurrence_date")).format(DateTimeFormatter.ofPattern("EEEE, d MMMM")) }.getOrDefault("")
            Text("$day · ${minuteLabel(plan.optInt("start_minute"))} - ${minuteLabel(plan.optInt("end_minute"))}")
            if (activity != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(NotedIcons.Circle, null, Modifier.size(12.dp), tint = color(activity.text("color")))
                Text(activity.text("name"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            repeatLabel(plan)?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            NotedOutlinedButton(onClick = { close(); editOnWeb() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Icon(NotedIcons.ExternalLink, null, Modifier.size(16.dp)); Text("Edit on the web", Modifier.padding(start = 8.dp))
            }
        }
    }
}

private fun repeatLabel(plan: JSONObject): String? = when (plan.text("frequency")) {
    "daily" -> "Repeats daily"; "weekly" -> "Repeats weekly"; "biweekly" -> "Repeats every two weeks"; "monthly" -> "Repeats monthly"
    else -> null
}

@Composable
fun WeekdayPicker(selected: Set<Int>, change: (Set<Int>) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        listOf("M", "T", "W", "T", "F", "S", "S").forEachIndexed { index, label ->
            NotedFilterChip(selected = index in selected, onClick = { change(if (index in selected) selected - index else selected + index) },
                label = { Text(label) }, modifier = Modifier.widthIn(min = 35.dp))
        }
    }
}
