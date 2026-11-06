package com.noted.android.features.channels

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.json
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.*

@Composable
fun ReminderEditor(title: String = "When should it ring?", timezone: String, close: () -> Unit,
    confirm: String = "Set reminder", save: suspend (JSONObject) -> Unit) {
    val zone = ZoneId.of(timezone)
    val now = ZonedDateTime.now(zone).plusMinutes(10)
    var date by remember { mutableStateOf(now.toLocalDate()) }
    var minute by remember { mutableIntStateOf(now.hour * 60 + now.minute) }
    var repeat by remember { mutableStateOf("none") }
    var urgent by remember { mutableStateOf(false) }
    EditorSheet(title, close, confirm, save = {
        val due = date.atStartOfDay().plusMinutes(minute.toLong()).atZone(zone)
        require(due.toInstant() > Instant.now()) { "Choose a future time." }
        save(json("due_at" to due.toOffsetDateTime().toString(), "timezone" to timezone, "repeat" to repeat, "urgent" to urgent))
    }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(10 to "10 min", 60 to "1 hour", 1440 to "Tomorrow").forEach { (minutes, label) ->
                NotedOutlinedButton(onClick = {
                    val due = ZonedDateTime.now(zone).plusMinutes(minutes.toLong())
                    date = due.toLocalDate(); minute = due.hour * 60 + due.minute
                }, modifier = Modifier.weight(1f), contentPadding = PaddingValues(8.dp)) { Text(label) }
            }
        }
        DateField("Date", date) { date = it }
        TimeField("Time", minute) { minute = it }
        Choice("Repeat", repeat, listOf("none" to "Once", "daily" to "Daily", "weekdays" to "Weekdays", "weekly" to "Weekly")) { repeat = it }
        Toggle("Urgent", urgent) { urgent = it }
    }
}
