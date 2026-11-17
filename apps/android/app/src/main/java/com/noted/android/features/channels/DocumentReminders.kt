package com.noted.android.features.channels

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

data class DocumentReminderCommand(
    val source: String,
    val start: Int,
    val end: Int,
    val reminder: ReminderCommand,
    val id: String = UUID.randomUUID().toString(),
) {
    fun linkedContent(): String {
        val name = reminder.content.trim().replace(Regex("[\\\\\\[\\]]")) { "\\${it.value}" }
        return source.substring(0, start) + "[$name](#reminder-$id)\n" + source.substring(end)
    }
}

fun documentReminderChange(before: String, after: String): DocumentReminderCommand? {
    if (after.length != before.length + 1) return null
    val caret = before.indices.firstOrNull { before[it] != after[it] } ?: before.length
    if (after[caret] != '\n' || before.substring(caret) != after.substring(caret + 1)) return null
    if (caret < before.length && before[caret] != '\n') return null
    val start = before.lastIndexOf('\n', caret - 1) + 1
    var fence: String? = null
    for (line in before.substring(0, start).lines()) {
        val match = Regex("^ {0,3}(`{3,}|~{3,})(.*)$").matchEntire(line) ?: continue
        val mark = match.groupValues[1]
        val previous = fence
        if (previous == null) fence = mark
        else if (mark[0] == previous[0] && mark.length >= previous.length && match.groupValues[2].isBlank()) fence = null
    }
    if (fence != null) return null
    val line = before.substring(start, caret)
    val indent = line.takeWhile { it == ' ' }.length
    if (indent > 3) return null
    val command = parseReminderCommand(line.substring(indent)) ?: return null
    return DocumentReminderCommand(before, start + indent, caret, command)
}

@Composable
fun DocumentReminderPanel(repository: NativeRepository, resource: Resource) {
    val actions = rememberActions()
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var removing by remember { mutableStateOf<JSONObject?>(null) }
    Column(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
        ResourceStatus(resource) { repository.changed() }
        androidx.compose.foundation.lazy.LazyColumn {
            items(resource.rows.size) { index ->
                val item = resource.rows[index]
                val done = item.text("status") == "done"
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    NotedCheckbox(done, if (actions.busy) null else { _ -> actions.run {
                        repository.mutate("/document-reminders/${item.text("id")}/actions", body = json("action" to if (done) "restore" else "done", "revision" to item.optInt("revision")))
                    } })
                    NotedTextButton(onClick = { editing = item }, modifier = Modifier.weight(1f)) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(item.text("name"), color = if (done) NotedStyle.colors.muted else NotedStyle.colors.text,
                                textDecoration = if (done) TextDecoration.LineThrough else TextDecoration.None)
                            Text(runCatching { ZonedDateTime.parse(item.text("due_at")).withZoneSameInstant(java.time.ZoneId.of(item.text("timezone"))).format(DateTimeFormatter.ofPattern("d MMM, HH:mm")) }.getOrDefault(""),
                                style = MaterialTheme.typography.labelSmall, color = NotedStyle.colors.muted)
                        }
                    }
                    if (!done) ActionIcon(NotedIcons.Snooze, "Snooze reminder", enabled = !actions.busy) { actions.run {
                        repository.mutate("/document-reminders/${item.text("id")}/actions", body = json("action" to "snooze", "revision" to item.optInt("revision")))
                    } }
                    ActionIcon(NotedIcons.DeleteOutline, "Remove reminder", enabled = !actions.busy) { removing = item }
                }
            }
        }
    }
    editing?.let { item -> ReminderEditor(timezone = item.text("timezone"), close = { editing = null }, content = item.text("name")) { schedule ->
        schedule.put("revision", item.optInt("revision"))
        repository.mutate("/document-reminders/${item.text("id")}", "PUT", schedule)
    } }
    removing?.let { item -> ConfirmDelete("Remove this reminder? Your note text stays in place.", { removing = null }) {
        repository.mutate("/document-reminders/${item.text("id")}?revision=${item.optInt("revision")}", "DELETE")
    } }
}
