package com.noted.android.features.channels

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun JournalScreen(repository: NativeRepository, channel: JSONObject, initialEntry: String? = null) {
    val path = "/channels/${channel.text("id")}/journal?limit=50&offset=0"
    val resource = rememberResource(repository, path)
    var more by remember { mutableStateOf(emptyList<JSONObject>()) }
    var selected by rememberSaveable(initialEntry) { mutableStateOf(initialEntry) }
    var creating by remember { mutableStateOf(false) }
    val actions = rememberActions()
    val entries = (resource.rows + more).distinctBy { it.text("id") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp)) {
        item {
            ResourceStatus(resource) { repository.changed() }
            NotedButton(onClick = { creating = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(NotedIcons.Add, null); Text("New entry", Modifier.padding(start = 8.dp))
            }
        }
        items(entries, key = { it.text("id") }) { entry ->
            NotedListItem(headlineContent = { Text(entry.text("title")) }, supportingContent = { Text(entry.text("updated_at").take(10)) },
                leadingContent = { Icon(NotedIcons.MenuBook, null) }, modifier = Modifier.clickable { selected = entry.text("id") })
        }
        if (entries.size >= 50 && entries.size % 50 == 0) item {
            NotedTextButton(onClick = { actions.run {
                more = more + org.json.JSONArray(repository.fetch("/channels/${channel.text("id")}/journal?limit=50&offset=${entries.size}")).objects()
            } }, enabled = !actions.busy) { Text("Load more entries") }
        }
        if (entries.isEmpty() && !resource.refreshing) item { EmptyState("Start an entry", "Give it a name, then write inside it.") }
    }
    if (creating) {
        var title by remember { mutableStateOf("") }
        EditorSheet("New journal entry", { creating = false }, enabled = title.isNotBlank(), save = {
            selected = JSONObject(repository.mutate("/channels/${channel.text("id")}/journal", body = json("title" to title))).text("id")
        }) { Field("Entry title", title, { title = it }) }
    }
    selected?.let { EntrySheet(repository, "/journal/$it", true) { selected = null } }
}

@Composable
fun DocumentScreen(repository: NativeRepository, channel: JSONObject) {
    MarkdownEditor(repository, "/channels/${channel.text("id")}/document", false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EntrySheet(repository: NativeRepository, path: String, journal: Boolean, close: () -> Unit) {
    NotedSheet(onDismissRequest = close, title = "Journal entry", sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Box(Modifier.fillMaxWidth().fillMaxHeight(.95f)) { MarkdownEditor(repository, path, journal, close) }
    }
}

@Composable
private fun MarkdownEditor(repository: NativeRepository, path: String, journal: Boolean, close: (() -> Unit)? = null) {
    val resource = rememberResource(repository, path)
    val remote = resource.obj
    val session by repository.session.collectAsStateWithLifecycle()
    val account = session?.partition ?: return
    var title by rememberSaveable(path) { mutableStateOf("") }
    var content by rememberSaveable(path) { mutableStateOf("") }
    var revision by rememberSaveable(path) { mutableIntStateOf(-1) }
    var dirty by rememberSaveable(path) { mutableStateOf(false) }
    var preview by rememberSaveable(path) { mutableStateOf(false) }
    var restored by remember(path) { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var templates by remember { mutableStateOf(false) }
    val actions = rememberActions()
    LaunchedEffect(path) {
        val draft = repository.drafts.read(account, "editor:$path")
        if (revision < 0 && draft.isNotBlank()) runCatching {
            val value = JSONObject(draft)
            content = value.text("content"); title = value.text("title"); revision = value.optInt("revision"); dirty = true
        }
        restored = true
    }
    LaunchedEffect(remote?.optInt("revision"), restored) {
        if (restored && remote != null && !dirty) {
            title = remote.text("title"); content = remote.text("content"); revision = remote.optInt("revision")
        }
    }
    LaunchedEffect(content, title, dirty, restored) {
        if (restored && dirty) repository.drafts.write(account, "editor:$path", json("content" to content, "title" to title, "revision" to revision).toString())
    }
    val currentDraft by rememberUpdatedState(if (dirty && restored) json("content" to content, "title" to title, "revision" to revision).toString() else null)
    DisposableEffect(account, path) { onDispose { currentDraft?.let { repository.drafts.write(account, "editor:$path", it) } } }
    Column(Modifier.fillMaxSize().imePadding().padding(horizontal = 18.dp)) {
        ResourceStatus(resource) { repository.changed() }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (dirty) "Unsaved draft" else "Saved", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            ActionIcon(if (preview) NotedIcons.Edit else NotedIcons.Visibility, if (preview) "Edit Markdown" else "Preview Markdown") { preview = !preview }
            ActionIcon(NotedIcons.NoteAdd, "Insert template") { templates = true }
            if (journal) ActionIcon(NotedIcons.DeleteOutline, "Delete entry") { deleting = true }
            NotedButton(enabled = revision >= 0 && dirty && !actions.busy, onClick = { actions.run {
                val fields = json("content" to content, "revision" to revision)
                if (journal) fields.put("title", title)
                val saved = JSONObject(repository.mutate(path, "PUT", fields))
                revision = saved.optInt("revision"); dirty = false
                repository.drafts.save(account, "editor:$path", "")
            } }) { Text("Save") }
        }
        if (journal) Field("Title", title, { title = it; dirty = true })
        if (remote != null || revision >= 0) {
            if (preview) LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 16.dp)) {
                item { Markdown(content, change = { content = it; dirty = true }) }
            } else NotedTextField(content, { content = continueTask(content, it); dirty = true },
                Modifier.weight(1f).fillMaxWidth().padding(vertical = 12.dp), placeholder = { Text("Start writing. Markdown works here.") })
        }
    }
    if (deleting) ConfirmDelete("Delete this entry?", { deleting = false }) {
        repository.mutate("$path?revision=$revision", "DELETE")
        repository.drafts.save(account, "editor:$path", "")
        close?.invoke()
    }
    if (templates) TemplatePicker(repository, { templates = false }) { content += it; dirty = true; templates = false }
}
