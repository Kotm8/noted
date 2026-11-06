package com.noted.android.features.channels

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PublishingSheet(repository: NativeRepository, channel: JSONObject, close: () -> Unit) {
    val id = channel.text("id")
    val scheduled = rememberResource(repository, "/channels/$id/scheduled-messages")
    val writing = rememberResource(repository, "/channels/$id/writing-prompt")
    val tracking = rememberResource(repository, "/time-tracking/tracker")
    val timezone = tracking.obj?.optJSONObject("preferences")?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    var add by remember { mutableStateOf(false) }
    var editWriting by remember { mutableStateOf(false) }
    val actions = rememberActions()
    NotedSheet(onDismissRequest = close, title = "Channel schedule", sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 600.dp), contentPadding = PaddingValues(20.dp)) {
            item {
                
                NotedButton(onClick = { add = true }, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) { Text("Schedule a message") }
                NotedOutlinedButton(onClick = { editWriting = true }, modifier = Modifier.fillMaxWidth()) { Text("Recurring writing prompt") }
                ResourceStatus(scheduled) { repository.changed() }
            }
            items(scheduled.rows.filter { it.text("status") == "pending" }, key = { it.text("id") }) { message ->
                NotedListItem(headlineContent = { Text(message.text("content"), maxLines = 3) }, supportingContent = { Text(message.text("send_at")) },
                    trailingContent = { ActionIcon(NotedIcons.Close, "Cancel scheduled message", !actions.busy) { actions.run {
                        repository.mutate("/scheduled-messages/${message.text("id")}?revision=${message.optInt("revision")}", "DELETE")
                    } } })
            }
        }
    }
    if (add || editWriting) {
        val existing = if (editWriting) writing.obj else null
        val now = ZonedDateTime.now(ZoneId.of(timezone)).plusHours(1)
        var text by remember(add, editWriting) { mutableStateOf(existing?.text("content").orEmpty()) }
        var date by remember { mutableStateOf(now.toLocalDate()) }
        var minute by remember { mutableIntStateOf(now.hour * 60 + now.minute) }
        var frequency by remember { mutableStateOf(existing?.text("frequency", "daily") ?: "daily") }
        var enabled by remember { mutableStateOf(existing?.optBoolean("enabled", true) ?: true) }
        EditorSheet(if (editWriting) "Writing prompt" else "Schedule message", { add = false; editWriting = false },
            enabled = text.isNotBlank(), save = {
                val due = date.atStartOfDay().plusMinutes(minute.toLong()).atZone(ZoneId.of(timezone)).toOffsetDateTime().toString()
                val fields = json("content" to text, "timezone" to timezone)
                if (editWriting) {
                    fields.put("start_at", due).put("frequency", frequency).put("enabled", enabled)
                        .put("weekdays", JSONArray(listOf(date.dayOfWeek.value - 1))).put("revision", existing?.optInt("revision") ?: 0)
                    repository.mutate("/channels/$id/writing-prompt", "PUT", fields)
                } else repository.mutate("/channels/$id/scheduled-messages", body = fields.put("send_at", due))
            }) {
            Field(if (editWriting) "Prompt" else "Message", text, { text = it }, singleLine = false)
            DateField("Date", date) { date = it }; TimeField("Time", minute) { minute = it }
            if (editWriting) {
                Choice("Repeat", frequency, listOf("daily", "weekly", "biweekly", "monthly").map { it to it.replaceFirstChar(Char::uppercaseChar) }) { frequency = it }
                Toggle("Enabled", enabled) { enabled = it }
            }
        }
    }
}
