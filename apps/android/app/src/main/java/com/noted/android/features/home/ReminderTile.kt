package com.noted.android.features.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.data.*
import com.noted.android.features.channels.ReminderEditor
import com.noted.android.ui.*
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.*

/**
 * The next reminder, with swipe right to complete it (Undo restores it) and swipe left to snooze it,
 * so a reminder can be handled from Home without opening its channel (phone home stories 16–18).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReminderTile(repository: NativeRepository, reminders: List<UpcomingReminder>, channels: List<JSONObject>, timezone: String,
    modifier: Modifier, open: (String) -> Unit) {
    val colors = NotedStyle.colors
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val actions = rememberActions()
    var creating by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf<UpcomingReminder?>(null) }
    var snoozing by remember { mutableStateOf<UpcomingReminder?>(null) }
    val next = reminders.firstOrNull()
    // A swipe can report its end more than once; a second "done" would carry a stale revision.
    var completed by remember { mutableStateOf(emptySet<String>()) }
    fun complete(reminder: UpcomingReminder) {
        val key = "${reminder.id}-${reminder.revision}"
        if (key in completed) return
        completed = completed + key
        actions.run {
            val done = try {
                JSONObject(repository.mutate("/messages/${reminder.id}/reminder/actions", body = json("action" to "done", "revision" to reminder.revision)))
            } catch (failure: Exception) {
                completed = completed - key
                throw failure
            }
            repository.changed()
            scope.launch {
                if (snackbar.showSnackbar("Reminder done", "Undo", duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) {
                    actions.run {
                        repository.mutate("/messages/${reminder.id}/reminder/actions", body = json("action" to "restore", "revision" to done.optInt("revision")))
                        repository.changed()
                    }
                }
            }
        }
    }
    val newReminder: @Composable () -> Unit = {
        Box(Modifier.padding(top = 8.dp).heightIn(min = 44.dp).clickable(onClickLabel = "New reminder") { creating = true }, contentAlignment = Alignment.Center) {
            Row(Modifier.height(32.dp).clip(RoundedCornerShape(16.dp)).border(1.dp, colors.border, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(NotedIcons.Add, null, Modifier.size(15.dp), tint = colors.secondary)
                Text("Reminder", color = colors.secondary, fontSize = 13.sp)
            }
        }
    }
    if (next == null) {
        Tile(modifier) {
            Text("Reminders", color = colors.muted, fontSize = 13.sp)
            Text("No reminders", color = colors.muted, modifier = Modifier.padding(top = 2.dp))
            Spacer(Modifier.weight(1f)); newReminder()
        }
    } else {
        val swipe = key(next.id, next.revision) { rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> complete(next)
                SwipeToDismissBoxValue.EndToStart -> snoozing = next
                else -> Unit
            }
            false
        }) }
        SwipeToDismissBox(state = swipe, modifier = modifier.clip(RoundedCornerShape(16.dp)), backgroundContent = {
            val completing = swipe.dismissDirection == SwipeToDismissBoxValue.StartToEnd
            Box(Modifier.fillMaxSize().background(if (completing) colors.successSurface else colors.hover).padding(horizontal = 16.dp),
                contentAlignment = if (completing) Alignment.CenterStart else Alignment.CenterEnd) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(if (completing) NotedIcons.Check else NotedIcons.Snooze, null, Modifier.size(18.dp), tint = if (completing) colors.success else colors.secondary)
                    Text(if (completing) "Done" else "Snooze", color = if (completing) colors.success else colors.secondary, fontSize = 12.sp)
                }
            }
        }) {
            Tile(Modifier.fillMaxSize(), onClick = { details = next }) {
                Text("Reminder · ${reminderWhen(next.due, timezone)}", color = if (next.due < Instant.now()) colors.accent else colors.muted, fontSize = 13.sp, maxLines = 1)
                Text(next.text.ifBlank { "Attachment reminder" }, color = colors.text, modifier = Modifier.padding(top = 2.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.weight(1f)); newReminder()
            }
        }
    }
    details?.let { reminder ->
        var rescheduling by remember { mutableStateOf(false) }
        if (rescheduling) ReminderEditor("Change the time", timezone, { rescheduling = false; details = null }) { schedule ->
            repository.mutate("/messages/${reminder.id}/reminder", "PUT", schedule); repository.changed()
        } else NotedSheet({ details = null }, title = "Reminder") {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(reminder.text.ifBlank { "Attachment reminder" }, style = MaterialTheme.typography.titleMedium)
                Text(reminderWhen(reminder.due, timezone), color = colors.muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NotedButton({ details = null; complete(reminder) }, Modifier.weight(1f)) { Text("Done") }
                    NotedOutlinedButton({ details = null; snoozing = reminder }, Modifier.weight(1f)) { Text("Snooze") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NotedOutlinedButton({ rescheduling = true }, Modifier.weight(1f)) { Text("Change time") }
                    NotedOutlinedButton({ details = null; open(channelRoute(reminder.channelId, ChannelLocation(message = reminder.id))) }, Modifier.weight(1f)) { Text("Open") }
                }
            }
        }
    }
    snoozing?.let { reminder ->
        NotedSheet({ snoozing = null }, title = "Snooze") {
            Column(Modifier.padding(12.dp)) {
                listOf(15 to "15 minutes", 60 to "1 hour", 180 to "3 hours", 1440 to "Tomorrow").forEach { (minutes, label) ->
                    NotedListItem(headlineContent = { Text(label) }, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable {
                        snoozing = null
                        actions.run {
                            repository.mutate("/messages/${reminder.id}/reminder/actions", body = json("action" to "snooze", "revision" to reminder.revision, "minutes" to minutes))
                            repository.changed()
                        }
                    })
                }
            }
        }
    }
    if (creating) NewReminderSheet(repository, channels, timezone) { creating = false }
}

/** Reminders are messages with a due time, so a new one is sent into a channel the owner picks. */
@Composable
private fun NewReminderSheet(repository: NativeRepository, channels: List<JSONObject>, timezone: String, close: () -> Unit) {
    val zone = ZoneId.of(timezone)
    val targets = channels.filter { it.text("kind") == "reminder" }.ifEmpty { channels.filter { it.text("kind") in listOf("note", "tasks") } }
    var text by remember { mutableStateOf("") }
    var channel by remember { mutableStateOf(targets.firstOrNull()?.text("id").orEmpty()) }
    var due by remember { mutableStateOf(ZonedDateTime.now(zone).plusHours(1).withSecond(0).withNano(0)) }
    var urgent by remember { mutableStateOf(false) }
    val actions = rememberActions()
    DesignSheet(close, "New reminder") {
        DesignLabel("Remind me to")
        Field("Reminder text", text, { text = it })
        DesignLabel("When")
        ReminderTimePicker(due) { due = it }
        if (targets.size > 1) Choice("Channel", channel, targets.map { it.text("id") to it.text("name") }) { channel = it }
        if (targets.isEmpty()) QuietNotice("Create a channel on the web before adding a reminder.")
        Toggle("Urgent (rings during quiet hours)", urgent) { urgent = it }
        PillButton({ actions.run {
            require(due.toInstant() > Instant.now()) { "Choose a future time." }
            repository.sendMessage("/channels/$channel/messages", text.trim(), json("due_at" to due.toOffsetDateTime().toString(),
                "timezone" to timezone, "repeat" to "none", "urgent" to urgent))
            close()
        } }, Modifier.fillMaxWidth().padding(top = 20.dp), primary = true,
            enabled = text.isNotBlank() && channel.isNotBlank() && !actions.busy) { Text("Save reminder") }
    }
}
