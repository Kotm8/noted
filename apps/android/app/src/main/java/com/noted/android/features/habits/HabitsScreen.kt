package com.noted.android.features.habits

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.features.calendar.WeekdayPicker
import com.noted.android.ui.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

@Composable
fun HabitsScreen(repository: NativeRepository) {
    val tracker = rememberResource(repository, "/time-tracking/tracker")
    val timezone = tracker.obj?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    var day by rememberSaveable { mutableStateOf(LocalDate.now(ZoneId.of(timezone)).toString()) }
    val resource = rememberResource(repository, "/habits?start=$day&end=$day")
    val actions = rememberActions()
    var edit by remember { mutableStateOf<JSONObject?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item {
            DateField("Your day", LocalDate.parse(day)) { day = it.toString() }
            ResourceStatus(resource) { repository.changed() }
        }
        listOf("Morning", "Anytime", "Evening").forEach { period ->
            val habits = resource.obj?.rows("habits").orEmpty().filter { it.text("period") == period }
            if (habits.isNotEmpty()) item { SectionTitle(period) }
            items(habits, key = { it.text("id") }) { habit ->
                val progress = resource.obj?.rows("progress")?.firstOrNull { it.text("habit_id") == habit.text("id") && it.text("day") == day }
                val value = progress?.optDouble("value") ?: 0.0
                val goal = habit.optDouble("goal", 1.0)
                val automatic = habit.text("activity_id").isNotBlank()
                val enabled = !automatic && !actions.busy && progress?.optBoolean("due") == true && !LocalDate.parse(day).isAfter(LocalDate.now(ZoneId.of(habit.text("timezone", timezone))))
                val set: (Double) -> Unit = { amount -> actions.run {
                    repository.mutate("/habits/${habit.text("id")}/progress", "PUT", json("day" to day, "value" to amount,
                        "revision" to (progress?.optInt("revision") ?: 0)))
                } }
                Row(Modifier.fillMaxWidth().heightIn(min = 68.dp), verticalAlignment = Alignment.CenterVertically) {
                    NotedCheckbox(value >= goal, if (enabled) { checked -> set(if (checked) goal else 0.0) } else null)
                    Column(Modifier.weight(1f).padding(horizontal = 6.dp)) {
                        Text(habit.text("name"))
                        if (automatic) Text("From tracked activity", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else if (progress?.optBoolean("due") == false) Text("Not scheduled today", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (habit.text("kind") != "check") NotedOutlinedButton(enabled = enabled, onClick = { set((value + 1).coerceAtMost(100000.0)) }, contentPadding = PaddingValues(horizontal = 10.dp)) {
                        Text("${number(value)} / ${number(goal)} ${habit.text("unit")}")
                    }
                    ActionIcon(NotedIcons.Edit, "Edit ${habit.text("name")}") { edit = habit }
                }
                if (habit.text("kind") != "check") NotedProgressIndicator(progress = { (value / goal).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().padding(start = 54.dp, end = 48.dp).height(2.dp))
            }
        }
        item {
            NotedOutlinedButton(onClick = { edit = JSONObject() }, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Icon(NotedIcons.Add, null, Modifier.size(18.dp)); Text("Add habit", Modifier.padding(start = 8.dp))
            }
        }
    }
    edit?.let { habit -> HabitEditor(repository, habit, timezone) { edit = null } }
}

private fun number(value: Double): String = if (value == value.toLong().toDouble()) value.toLong().toString() else "%.1f".format(value)

@Composable
private fun HabitEditor(repository: NativeRepository, habit: JSONObject, timezone: String, close: () -> Unit) {
    var name by remember { mutableStateOf(habit.text("name")) }
    var kind by remember { mutableStateOf(habit.text("kind", "check")) }
    var goal by remember { mutableStateOf(habit.optDouble("goal", 1.0).toString()) }
    var unit by remember { mutableStateOf(habit.text("unit", "times")) }
    var period by remember { mutableStateOf(habit.text("period", "Anytime")) }
    var linked by remember { mutableStateOf(habit.text("activity_id")) }
    var weekdays by remember { mutableStateOf(habit.optJSONArray("weekdays")?.let { days -> (0 until days.length()).map { days.optInt(it) }.toSet() } ?: (0..6).toSet()) }
    var reminders by remember { mutableStateOf(!habit.isNull("reminder_minute")) }
    var reminderMinute by remember { mutableIntStateOf(habit.optInt("reminder_minute", 540)) }
    var firstReminder by remember { mutableStateOf(LocalDate.parse(habit.text("reminder_start", LocalDate.now(ZoneId.of(timezone)).toString()))) }
    var removing by remember { mutableStateOf(false) }
    val activities = rememberResource(repository, "/time-tracking/activities")
    val id = habit.text("id")
    if (removing) {
        ConfirmDelete("Archive $name?", { removing = false }) {
            repository.mutate("/habits/$id?revision=${habit.optInt("revision")}", "DELETE"); close()
        }
        return
    }
    EditorSheet(if (id.isBlank()) "New habit" else "Edit habit", close, enabled = name.isNotBlank() && weekdays.isNotEmpty(), save = {
        val amount = if (kind == "check") 1.0 else goal.toDoubleOrNull() ?: error("Enter a valid target.")
        val fields = json("name" to name, "kind" to kind, "goal" to amount, "unit" to if (kind == "time") "min" else unit,
            "period" to period, "weekdays" to JSONArray(weekdays.sorted()), "activity_id" to linked.takeIf { kind == "time" && it.isNotBlank() },
            "timezone" to habit.text("timezone", timezone), "starts_on" to habit.text("starts_on", LocalDate.now(ZoneId.of(timezone)).toString()),
            "reminder_minute" to if (reminders) reminderMinute else null, "reminder_start" to if (reminders) firstReminder.toString() else null)
        if (id.isNotBlank()) fields.put("revision", habit.optInt("revision"))
        repository.mutate(if (id.isBlank()) "/habits" else "/habits/$id", if (id.isBlank()) "POST" else "PUT", fields)
    }) {
        Field("Name", name, { name = it })
        Choice("Goal", kind, listOf("check" to "Check off", "count" to "Count", "time" to "Minutes")) { kind = it }
        if (kind != "check") { Field("Daily target", goal, { goal = it }); if (kind == "count") Field("Unit", unit, { unit = it }) }
        if (kind == "time") Choice("Tracked activity", linked, listOf("" to "Enter progress manually") + activities.rows.filter { !it.optBoolean("archived") }.map { it.text("id") to it.text("name") }) { linked = it }
        Choice("Time of day", period, listOf("Morning", "Anytime", "Evening").map { it to it }) { period = it }
        WeekdayPicker(weekdays) { weekdays = it }
        Toggle("Reminder", reminders) { reminders = it }
        if (reminders) {
            DateField("First reminder", firstReminder) { firstReminder = it }
            TimeField("Remind at", reminderMinute) { reminderMinute = it }
        }
        if (id.isNotBlank()) NotedTextButton(onClick = { removing = true }) { Text("Archive habit", color = MaterialTheme.colorScheme.error) }
    }
}
