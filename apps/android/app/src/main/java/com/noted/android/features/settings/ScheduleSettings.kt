package com.noted.android.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
fun ScheduleSettings(repository: NativeRepository) {
    val resource = rememberResource(repository, "/time-tracking/tracker")
    val preferences = resource.obj?.optJSONObject("preferences")
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    val value = draft ?: preferences
    val actions = rememberActions()
    fun set(key: String, item: Any) { draft = value!!.copy().put(key, item) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Calendar", style = MaterialTheme.typography.titleLarge)
        ResourceStatus(resource) { repository.changed() }
        if (value != null) {
            TimeField("Day starts", value.optInt("start_minute", 480)) { set("start_minute", it) }
            TimeField("Day ends", value.optInt("end_minute", 1380)) { set("end_minute", it) }
            Field("Timezone", value.text("timezone", ZoneId.systemDefault().id), { set("timezone", it) })
            val work = value.optJSONObject("work_schedule") ?: json("mode" to "weekly", "off_weekdays" to JSONArray(listOf(5, 6)), "work_days" to 2, "off_days" to 2,
                "cycle_start" to LocalDate.now().toString(), "overrides" to JSONObject())
            fun setWork(key: String, item: Any) { set("work_schedule", work.copy().put(key, item)) }
            SectionTitle("Workdays and days off")
            Choice("Schedule", work.text("mode", "weekly"), listOf("weekly" to "Chosen weekdays", "cycle" to "Rotating cycle")) { setWork("mode", it) }
            if (work.text("mode", "weekly") == "weekly") {
                Text("Days off", style = MaterialTheme.typography.labelMedium)
                val days = work.optJSONArray("off_weekdays")
                WeekdayPicker((0 until (days?.length() ?: 0)).map { days!!.optInt(it) }.toSet()) { setWork("off_weekdays", JSONArray(it.sorted())) }
            } else {
                Choice("Work days", work.optInt("work_days", 2), (1..14).map { it to it.toString() }) { setWork("work_days", it) }
                Choice("Off days", work.optInt("off_days", 2), (1..14).map { it to it.toString() }) { setWork("off_days", it) }
                DateField("Cycle begins", runCatching { LocalDate.parse(work.text("cycle_start")) }.getOrDefault(LocalDate.now())) { setWork("cycle_start", it.toString()) }
            }
            var exception by remember { mutableStateOf(LocalDate.now()) }
            SectionTitle("One-off change")
            DateField("Date", exception) { exception = it }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NotedOutlinedButton(onClick = { setWork("overrides", (work.optJSONObject("overrides") ?: JSONObject()).copy().put(exception.toString(), "off")) }) { Text("Day off") }
                NotedOutlinedButton(onClick = { setWork("overrides", (work.optJSONObject("overrides") ?: JSONObject()).copy().put(exception.toString(), "work")) }) { Text("Workday") }
                NotedTextButton(onClick = { setWork("overrides", (work.optJSONObject("overrides") ?: JSONObject()).copy().apply { remove(exception.toString()) }) }) { Text("Reset") }
            }
            work.optJSONObject("overrides")?.let { overrides -> overrides.keys().asSequence().sorted().forEach { date ->
                Text("$date: ${if (overrides.optString(date) == "off") "Day off" else "Workday"}", style = MaterialTheme.typography.bodySmall)
            } }
            NotedButton(onClick = { actions.run {
                repository.mutate("/time-tracking/preferences", "PUT", value.copy().put("revision", resource.obj!!.optInt("revision"))); draft = null
            } }, enabled = draft != null && !actions.busy, modifier = Modifier.fillMaxWidth()) { Text("Save calendar settings") }
        }
    }
}
