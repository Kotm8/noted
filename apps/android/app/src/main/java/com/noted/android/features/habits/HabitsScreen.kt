package com.noted.android.features.habits

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.features.home.duration
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HabitsScreen(repository: NativeRepository) {
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val activities = rememberResource(repository, "/time-tracking/activities")
    val timezone = tracker.obj?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    val day = LocalDate.now(ZoneId.of(timezone)).toString()
    val resource = rememberResource(repository, "/habits?start=$day&end=$day")
    val actions = rememberActions()
    val colors = NotedStyle.colors
    val context = LocalContext.current
    val origin = repository.session.collectAsState().value?.origin
    var counting by remember { mutableStateOf<Pair<JSONObject, JSONObject?>?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp)) {
        item {
            ResourceStatus(resource) { repository.changed("habits") }
        }
        listOf("Morning", "Anytime", "Evening").forEach { period ->
            val habits = resource.obj?.rows("habits").orEmpty().filter { it.text("period") == period }
            if (habits.isNotEmpty()) item { DesignLabel(period) }
            items(habits, key = { it.text("id") }) { habit ->
                val progress = resource.obj?.rows("progress")?.firstOrNull { it.text("habit_id") == habit.text("id") && it.text("day") == day }
                val value = progress?.optDouble("value") ?: 0.0
                val goal = habit.optDouble("goal", 1.0).coerceAtLeast(.0001)
                val automatic = habit.text("activity_id").isNotBlank()
                val enabled = !automatic && !actions.busy && progress?.optBoolean("due") == true &&
                    !LocalDate.parse(day).isAfter(LocalDate.now(ZoneId.of(habit.text("timezone", timezone))))
                fun set(amount: Double) = actions.run {
                    repository.mutate("/habits/${habit.text("id")}/progress", "PUT", json("day" to day, "value" to amount,
                        "revision" to (progress?.optInt("revision") ?: 0)))
                }
                val activity = activities.rows.firstOrNull { it.text("id") == habit.text("activity_id") }
                val tint = color(activity?.text("color").orEmpty(), colors.accent)
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(top = if (automatic) 8.dp else 0.dp),
                    verticalAlignment = if (automatic) Alignment.Top else Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.width(44.dp), contentAlignment = Alignment.Center) {
                        when {
                            automatic -> Box(Modifier.padding(top = 6.dp).size(10.dp).background(tint, CircleShape))
                            habit.text("kind") == "check" -> IconButton({ set(if (value >= goal) 0.0 else goal) },
                                Modifier.size(44.dp), enabled = enabled) {
                                Icon(if (value >= goal) NotedIcons.Check else NotedIcons.Circle,
                                    if (value >= goal) "Mark ${habit.text("name")} not done" else "Mark ${habit.text("name")} done",
                                    Modifier.size(22.dp), tint = if (value >= goal) colors.success else colors.muted)
                            }
                            else -> Box(Modifier.fillMaxWidth().heightIn(min = 44.dp)
                                .combinedClickable(enabled = enabled, role = Role.Button,
                                    onClickLabel = "Add one to ${habit.text("name")}",
                                    onLongClickLabel = "Set ${habit.text("name")} progress",
                                    onLongClick = { counting = habit to progress }) { set(value + 1) },
                                contentAlignment = Alignment.Center) {
                                Text("${number(value)}/${number(goal)}",
                                    color = if (value >= goal) colors.success else colors.accent,
                                    style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(habit.text("name"), color = if (value >= goal) colors.muted else colors.text,
                            style = MaterialTheme.typography.bodyLarge)
                        Text(when {
                            automatic -> "From tracked ${activity?.text("name") ?: "activity"}"
                            progress?.optBoolean("due") == false -> "Not scheduled today"
                            habit.text("kind") == "check" -> if (habit.optJSONArray("weekdays")?.length() == 7) "Every day" else "Every scheduled day"
                            else -> habit.text("unit")
                        }, color = colors.muted, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Normal))
                        if (automatic || habit.text("kind") == "time") {
                            Box(Modifier.padding(top = 8.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(colors.input)) {
                                Box(Modifier.fillMaxWidth((value / goal).toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(tint))
                            }
                            Text("${duration((value * 60).toLong())} of ${duration((goal * 60).toLong())}",
                                Modifier.padding(top = 4.dp), color = colors.muted,
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Normal))
                        }
                    }
                    if (!automatic && habit.text("kind") != "check") {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            HabitCountButton(false, habit.text("name"), enabled && value > 0) { set((value - 1).coerceAtLeast(0.0)) }
                            HabitCountButton(true, habit.text("name"), enabled) { set(value + 1) }
                        }
                    }
                }
            }
        }
        item {
            Text("Add or change habits on the web.", Modifier.padding(top = 24.dp, bottom = 16.dp)
                .heightIn(min = 44.dp).clickable(enabled = origin != null, role = Role.Button) {
                    origin?.let { openOnWeb(context, it, "/habits") }
                }, color = colors.muted, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Normal))
        }
    }
    counting?.let { (habit, progress) -> HabitProgressEditor(repository, habit, progress, day) { counting = null } }
}

@Composable
private fun HabitCountButton(add: Boolean, name: String, enabled: Boolean, click: () -> Unit) {
    val colors = NotedStyle.colors
    IconButton(click, Modifier.size(44.dp).border(1.dp, colors.border, CircleShape), enabled = enabled) {
        Icon(if (add) NotedIcons.Add else NotedIcons.Remove, "${if (add) "Add one to" else "Remove one from"} $name",
            Modifier.size(22.dp), tint = if (enabled) colors.secondary else colors.faint.copy(alpha = .5f))
    }
}

private fun number(value: Double) = if (value == value.toLong().toDouble()) value.toLong().toString() else "%.1f".format(value)
