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
    var due by remember { mutableStateOf(ZonedDateTime.now(zone).plusHours(1).withSecond(0).withNano(0)) }
    var repeat by remember { mutableStateOf("none") }
    var urgent by remember { mutableStateOf(false) }
    val actions = rememberActions()
    DesignSheet(close, title) {
        ReminderTimePicker(due) { due = it }
        Choice("Repeat", repeat, listOf("none" to "Once", "daily" to "Daily", "weekdays" to "Weekdays", "weekly" to "Weekly")) { repeat = it }
        Toggle("Urgent", urgent) { urgent = it }
        PillButton({ actions.run {
            require(due.toInstant() > Instant.now()) { "Choose a future time." }
            save(json("due_at" to due.toOffsetDateTime().toString(), "timezone" to timezone, "repeat" to repeat, "urgent" to urgent))
            close()
        } }, Modifier.fillMaxWidth().padding(top = 20.dp), primary = true, enabled = !actions.busy) { Text(confirm) }
    }
}
