package com.noted.android.features.channels

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.noted.android.data.*
import com.noted.android.features.media.AttachmentView
import com.noted.android.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.UUID

@Composable
fun ChannelScreen(repository: NativeRepository, channel: JSONObject, appearance: JSONObject?, location: ChannelLocation = ChannelLocation(), latest: () -> Unit = {}) {
    when (channel.text("kind")) {
        "journal" -> JournalScreen(repository, channel, location.entry)
        "document" -> DocumentScreen(repository, channel)
        else -> MessageList(repository, channel, appearance, initialFocus = location.message.takeIf { location.thread == null }, initialThread = location.thread,
            threadFocus = location.message.takeIf { location.thread != null }, openLatest = latest)
    }
}

@Composable
private fun MessageList(repository: NativeRepository, channel: JSONObject, appearance: JSONObject?, thread: String? = null,
    initialFocus: String? = null, initialThread: String? = null, threadFocus: String? = null, openLatest: () -> Unit = {}) {
    var focus by remember(initialFocus) { mutableStateOf(initialFocus) }
    val path = if (thread == null) "/channels/${channel.text("id")}/messages" else "/messages/$thread/thread"
    val resource = rememberResource(repository, path + (focus?.let { "?around=$it" } ?: ""))
    val page = if (thread == null) resource.obj else resource.obj?.optJSONObject("replies")
    var older by remember(path, focus) { mutableStateOf(emptyList<JSONObject>()) }
    var cursor by remember(path, focus) { mutableStateOf<String?>(null) }
    var newer by remember(path, focus) { mutableStateOf(emptyList<JSONObject>()) }
    var newerCursor by remember(path, focus) { mutableStateOf<String?>(null) }
    val latest = page?.rows("items").orEmpty()
    val messages = (older + latest + newer).distinctBy { it.text("id") }.sortedBy { it.text("created_at") }
    val pending by repository.pending.collectAsStateWithLifecycle()
    val waiting = pending.filter { it.path == path }
    val before = if (older.isEmpty()) page?.text("next_cursor") else cursor
    val after = if (newer.isEmpty()) page?.text("newer_cursor") else newerCursor
    val endIndex = messages.size + waiting.size + (if (thread != null) 1 else 0) +
        (if (!before.isNullOrBlank()) 1 else 0) + (if (!after.isNullOrBlank()) 1 else 0) - 1
    val actions = rememberActions()
    var selectedThread by remember(initialThread) { mutableStateOf(initialThread) }
    var located by remember(focus) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    var previousLast by remember { mutableStateOf<String?>(null) }
    var scrollRequest by remember { mutableIntStateOf(0) }
    var previousScrollRequest by remember { mutableIntStateOf(0) }
    val timezone = rememberResource(repository, "/time-tracking/tracker").obj?.optJSONObject("preferences")?.text("timezone")
        ?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    val groupMinutes = appearance?.optInt("messageGroupMinutes", 2) ?: 2
    val layout = appearance?.optString("messageLayout", "minute") ?: "minute"
    LaunchedEffect(messages.lastOrNull()?.text("id"), waiting.size, scrollRequest) {
        if (focus != null) return@LaunchedEffect
        val last = messages.lastOrNull()?.text("id")
        val nearBottom = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= listState.layoutInfo.totalItemsCount - 4 } ?: true
        if (previousLast == null || nearBottom || scrollRequest != previousScrollRequest) {
            if (endIndex >= 0) listState.scrollToItem(endIndex)
        }
        previousScrollRequest = scrollRequest
        previousLast = last
    }
    LaunchedEffect(messages.map { it.text("id") }, focus) {
        val index = messages.indexOfFirst { it.text("id") == focus }
        if (!located && index >= 0) {
            val preceding = (if (thread != null) 1 else 0) + (if (!page?.text("next_cursor").isNullOrBlank()) 1 else 0)
            listState.scrollToItem(index + preceding)
            located = true
        }
    }
    Column(Modifier.fillMaxSize()) {
        ResourceStatus(resource) { repository.changed() }
        if (focus != null && thread == null) NotedTextButton(openLatest, Modifier.fillMaxWidth()) { Text("Back to latest notes") }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp)) {
            if (thread != null) resource.obj?.optJSONObject("root")?.let { root -> item {
                Text("Original note", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Markdown(root.text("content"), modifier = Modifier.padding(vertical = 8.dp))
                HorizontalDivider(Modifier.padding(vertical = 12.dp))
            } }
            if (!before.isNullOrBlank()) item {
                NotedTextButton(enabled = !actions.busy, onClick = { actions.run {
                    val result = JSONObject(repository.fetch("$path?before=${Uri.encode(before)}"))
                    val previous = if (thread == null) result else result.getJSONObject("replies")
                    older = previous.rows("items") + older; cursor = previous.text("next_cursor").takeIf { it.isNotBlank() }
                } }, modifier = Modifier.fillMaxWidth()) { Text("Load earlier notes") }
            }
            itemsIndexed(messages, key = { _, message -> message.text("id") }) { index, message ->
                val current = runCatching { Instant.parse(message.text("created_at")).atZone(ZoneId.of(timezone)) }.getOrNull()
                val previous = messages.getOrNull(index - 1)?.text("created_at")?.let {
                    runCatching { Instant.parse(it).atZone(ZoneId.of(timezone)) }.getOrNull()
                }
                val newDay = current?.toLocalDate() != previous?.toLocalDate()
                val pause = previous == null || (current != null && Duration.between(previous, current).seconds > groupMinutes * 60)
                if (newDay && current != null) Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                    HorizontalDivider(Modifier.weight(1f)); Text(current.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")),
                        Modifier.padding(horizontal = 10.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider(Modifier.weight(1f))
                }
                if (pause && !newDay) Spacer(Modifier.height(16.dp))
                val time = current?.format(DateTimeFormatter.ofPattern("HH:mm"))
                Box(Modifier.fillMaxWidth().background(if (message.text("id") == focus) NotedStyle.colors.accent.copy(alpha = .08f) else androidx.compose.ui.graphics.Color.Transparent)) {
                    MessagePresentation(layout, time, pause, pause || current?.minute != previous?.minute) {
                        MessageRow(repository, message, timezone, thread == null, { selectedThread = message.text("id") }, time)
                    }
                }
            }
            if (!after.isNullOrBlank()) item {
                NotedTextButton(enabled = !actions.busy, onClick = { actions.run {
                    val result = JSONObject(repository.fetch("$path?after=${Uri.encode(after)}"))
                    val next = if (thread == null) result else result.getJSONObject("replies")
                    newer = newer + next.rows("items"); newerCursor = next.text("newer_cursor").takeIf { it.isNotBlank() }
                } }, modifier = Modifier.fillMaxWidth()) { Text("Load newer notes") }
            }
            waiting.forEach { message -> item(key = message.id) {
                Column(Modifier.padding(vertical = 10.dp)) {
                    Markdown(message.body.text("content"))
                    if (message.error == null) Text("Waiting to send", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else {
                        Text(message.error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        Row {
                            NotedTextButton(onClick = { actions.run { repository.retry(message.id) } }) { Text("Retry") }
                            NotedTextButton(onClick = { actions.run { repository.discard(message.id) } }) { Text("Discard") }
                        }
                    }
                }
            } }
            if (messages.isEmpty() && waiting.isEmpty() && !resource.refreshing && resource.error == null) item {
                EmptyState("A place to put your thoughts", "Write your first note below.")
            }
        }
        MessageComposer(repository, channel, path, timezone, thread != null) {
            scrollRequest++
            if (focus != null) { if (thread == null) openLatest() else focus = null }
        }
    }
    selectedThread?.let { id -> ThreadSheet(repository, channel, id, appearance, threadFocus.takeIf { id == initialThread }) { selectedThread = null } }
}

@Composable
private fun MessageRow(repository: NativeRepository, message: JSONObject, timezone: String,
    canReply: Boolean, reply: () -> Unit, time: String?) {
    var controls by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf(false) }
    var remind by remember { mutableStateOf(false) }
    val actions = rememberActions()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val id = message.text("id")
    Column(Modifier.fillMaxWidth().clickable { controls = !controls }.padding(vertical = 5.dp)) {
        if (message.optBoolean("ai_generated")) Text("AI reply", Modifier.padding(bottom = 2.dp),
            style = MaterialTheme.typography.labelSmall, color = NotedStyle.colors.muted)
        Markdown(message.text("content"), activate = { controls = !controls }, change = { updated -> actions.run {
            repository.mutate("/messages/$id", "PUT", json("content" to updated, "expected_content" to message.text("content")))
        } })
        message.rows("attachments").forEach { AttachmentView(repository, it) }
        val reminder = message.optJSONObject("reminder")
        if (reminder != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(NotedIcons.NotificationsNone, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                val due = runCatching { Instant.parse(reminder.text("due_at")).atZone(ZoneId.of(timezone)) }.getOrNull()
                Text(if (reminder.text("status") == "done") "Done" else due?.format(DateTimeFormatter.ofPattern("d MMM, HH:mm")) ?: "Reminder",
                    Modifier.padding(start = 6.dp).weight(1f), style = MaterialTheme.typography.labelSmall)
                if (reminder.text("status") != "done") {
                    ActionIcon(NotedIcons.Check, "Mark reminder done", enabled = !actions.busy) { actions.run {
                        repository.mutate("/messages/$id/reminder/actions", body = json("action" to "done", "revision" to reminder.optInt("revision")))
                    } }
                    ActionIcon(NotedIcons.Snooze, "Snooze reminder", enabled = !actions.busy) { actions.run {
                        val preferences = JSONObject(repository.api.request("/notifications/settings"))
                        repository.mutate("/messages/$id/reminder/actions", body = json("action" to "snooze", "revision" to reminder.optInt("revision"),
                            "minutes" to preferences.optInt("snooze_minutes", 10)))
                    } }
                }
            }
        }
        if (message.optInt("reply_count") > 0 && canReply) NotedTextButton(onClick = reply, contentPadding = PaddingValues(0.dp)) {
            val replies = message.optInt("reply_count")
            val last = lastReply(message.text("last_reply_at"), timezone)
            Icon(NotedIcons.Forum, null, Modifier.size(16.dp))
            Text("$replies ${if (replies == 1) "reply" else "replies"}", Modifier.padding(start = 8.dp))
            if (last != null) Text(" · Last reply $last", color = NotedStyle.colors.muted)
        }
        if (controls && time != null) Text(time, style = MaterialTheme.typography.labelSmall, color = NotedStyle.colors.muted)
        if (controls) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            if (canReply) ActionIcon(NotedIcons.Forum, "Open thread", action = reply)
            ActionIcon(NotedIcons.NotificationsNone, "Set reminder") { remind = true }
            ActionIcon(NotedIcons.Edit, "Edit note") { edit = true }
            ActionIcon(NotedIcons.ContentCopy, "Copy note") { clipboard.setText(AnnotatedString(message.text("content"))) }
            ActionIcon(NotedIcons.Share, "Share note") {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, message.text("content")), "Share note"))
            }
            ActionIcon(NotedIcons.DeleteOutline, "Delete note") { remove = true }
        }
    }
    if (edit) {
        var content by remember { mutableStateOf(message.text("content")) }
        EditorSheet("Edit note", { edit = false }, save = {
            repository.mutate("/messages/$id", "PUT", json("content" to content, "expected_content" to message.text("content")))
        }) { Field("Note", content, { content = continueTask(content, it) }, singleLine = false) }
    }
    if (remove) ConfirmDelete("Delete this note?", { remove = false }) { repository.mutate("/messages/$id", "DELETE") }
    if (remind) ReminderEditor(timezone = timezone, close = { remind = false }) {
        repository.mutate("/messages/$id/reminder", "PUT", it)
    }
}

private fun lastReply(iso: String, timezone: String): String? = runCatching {
    val zone = ZoneId.of(timezone)
    val at = Instant.parse(iso).atZone(zone)
    val today = java.time.LocalDate.now(zone)
    val time = at.format(DateTimeFormatter.ofPattern("HH:mm"))
    when (at.toLocalDate()) {
        today -> "today at $time"
        today.minusDays(1) -> "yesterday at $time"
        else -> at.format(DateTimeFormatter.ofPattern(if (at.year == today.year) "d MMM" else "d MMM yyyy"))
    }
}.getOrNull()

@Composable
private fun MessageComposer(repository: NativeRepository, channel: JSONObject, path: String, timezone: String, thread: Boolean, sent: () -> Unit) {
    var text by rememberSaveable(path) { mutableStateOf("") }
    var restored by remember(path) { mutableStateOf(false) }
    var files by remember { mutableStateOf(emptyList<Uri>()) }
    var scheduling by remember { mutableStateOf(false) }
    var templates by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val session by repository.session.collectAsStateWithLifecycle()
    val account = session?.partition ?: return
    val actions = rememberActions()
    LaunchedEffect(path) {
        if (text.isEmpty()) text = repository.drafts.read(account, path)
        restored = true
    }
    val draftText by rememberUpdatedState(text)
    val draftRestored by rememberUpdatedState(restored)
    DisposableEffect(account, path) { onDispose { if (draftRestored) repository.drafts.write(account, path, draftText) } }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { files = (files + it).distinct().take(10) }
    val submit: (JSONObject?) -> Unit = { reminder ->
        val content = text
        val attached = files
        actions.run {
            if (attached.isEmpty()) repository.sendMessage(path, content, reminder)
            else {
                require(!thread) { "Attach files in the main channel." }
                repository.api.upload(context, "/channels/${channel.text("id")}/messages/with-files", content, attached, reminder, UUID.randomUUID().toString())
                repository.changed()
            }
            text = ""; files = emptyList()
            repository.drafts.save(account, path, "")
            sent()
        }
    }
    val send = {
        if (text.isNotBlank() || files.isNotEmpty()) {
            if (channel.text("kind") == "reminder" && !thread) scheduling = true else submit(null)
        }
    }
    Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        if (files.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${files.size} files attached", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall)
            NotedTextButton(onClick = { files = emptyList() }) { Text("Remove") }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(NotedStyle.colors.input, RoundedCornerShape(6.dp))
            .border(1.dp, NotedStyle.colors.border, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!thread) ActionIcon(NotedIcons.Add, "Add files") { pickFiles.launch(arrayOf("*/*")) }
            NotedTextField(text, { text = continueTask(text, it); repository.drafts.write(account, path, text) }, Modifier.weight(1f), maxLines = 6, chrome = false,
                fieldLabel = if (thread) "Reply" else "Message #${channel.text("name")}",
                placeholder = { Text(if (thread) "Reply" else "Message #${channel.text("name")}") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
            ActionIcon(NotedIcons.NoteAdd, "Insert template") { templates = true }
            NotedFilledIconButton(onClick = send, enabled = !actions.busy && (text.isNotBlank() || files.isNotEmpty()), modifier = Modifier.padding(start = 4.dp)) {
                if (actions.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(NotedIcons.ArrowUpward, "Send note")
            }
        }
    }
    if (scheduling) ReminderEditor(timezone = timezone, close = { scheduling = false }, confirm = "Send reminder") { reminder ->
        if (files.isEmpty()) repository.sendMessage(path, text, reminder)
        else { repository.api.upload(context, "/channels/${channel.text("id")}/messages/with-files", text, files, reminder, UUID.randomUUID().toString()); repository.changed() }
        text = ""; files = emptyList()
        repository.drafts.save(account, path, "")
        sent()
    }
    if (templates) TemplatePicker(repository, { templates = false }) { text += it; repository.drafts.write(account, path, text); templates = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThreadSheet(repository: NativeRepository, channel: JSONObject, root: String, appearance: JSONObject?, focus: String? = null, close: () -> Unit) {
    NotedSheet(onDismissRequest = close, title = "Thread", sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Box(Modifier.fillMaxWidth().fillMaxHeight(.95f)) { MessageList(repository, channel, appearance, root, initialFocus = focus) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TemplatePicker(repository: NativeRepository, close: () -> Unit, select: (String) -> Unit) {
    val templates = rememberResource(repository, "/templates/notes")
    NotedSheet(onDismissRequest = close, title = "Note templates") {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 480.dp), contentPadding = PaddingValues(20.dp)) {
            item { ResourceStatus(templates) { repository.changed() } }
            itemsIndexed(templates.rows) { _, template -> NotedListItem(headlineContent = { Text(template.text("name")) },
                supportingContent = { Text(template.text("content").take(100), maxLines = 2) }, modifier = Modifier.clickable { select(template.text("content")) }) }
            if (templates.rows.isEmpty()) item { EmptyState("No templates yet", "Create reusable note templates in Settings.") }
        }
    }
}
