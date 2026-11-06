package com.noted.android.features.search

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.features.media.AttachmentView
import com.noted.android.ui.*
import org.json.JSONObject

private data class LibraryItem(val file: JSONObject, val channel: JSONObject, val message: JSONObject)

@Composable
fun LibraryScreen(repository: NativeRepository, channels: List<JSONObject>, open: (String) -> Unit) {
    var selected by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    val sources = channels.filter { it.text("kind") !in listOf("document", "journal") && (selected.isBlank() || it.text("id") == selected) }
    var sourceIndex by remember(selected) { mutableIntStateOf(0) }
    var before by remember(selected) { mutableStateOf<String?>(null) }
    var collected by remember(selected) { mutableStateOf(emptyList<LibraryItem>()) }
    var emptyPages by remember(selected) { mutableIntStateOf(0) }
    val source = sources.getOrNull(sourceIndex)
    val path = source?.let { "/channels/${it.text("id")}/messages?limit=200" + (before?.let { cursor -> "&before=${Uri.encode(cursor)}" } ?: "") }
    val page = rememberResource(repository, path)
    val current = page.obj?.rows("items").orEmpty().flatMap { message -> message.rows("attachments").map { LibraryItem(it, source!!, message) } }
    val files = (collected + current).distinctBy { it.file.text("id") }
    val next = page.obj?.text("next_cursor")?.takeIf { it.isNotBlank() }
    val more = next != null || sourceIndex + 1 < sources.size
    fun advance() {
        collected = files
        if (next != null) before = next else { sourceIndex++; before = null }
    }
    LaunchedEffect(path, page.raw, page.refreshing) {
        if (!page.refreshing && page.obj != null && page.error == null && current.isEmpty() && more && emptyPages < 8) {
            emptyPages++
            advance()
        }
    }
    val matches = files.filter { item ->
        val type = item.file.text("content_type")
        (kind == "all" || kind == "images" && type.startsWith("image/") || kind == "video" && item.file.text("playback_url").isNotBlank() ||
            kind == "files" && !type.startsWith("image/") && item.file.text("playback_url").isBlank()) &&
            item.file.text("original_filename").contains(query.trim(), ignoreCase = true)
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
        Field("Find a file", query, { query = it.take(200) })
        Choice("Channel", selected, listOf("" to "All channels") + channels.filter { it.text("kind") !in listOf("document", "journal") }.map { it.text("id") to it.text("name") }) { selected = it }
        Choice("Show", kind, listOf("all" to "All files", "images" to "Images and GIFs", "video" to "Video", "files" to "Other files")) { kind = it }
        ResourceStatus(page) { repository.changed("notes") }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(matches, key = { it.file.text("id") }) { item ->
                Column {
                    AttachmentView(repository, item.file)
                    NotedTextButton({ open(channelRoute(item.channel.text("id"), ChannelLocation(message = item.message.text("id")))) }) {
                        Text("#${item.channel.text("name")} · Open note", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            if (matches.isEmpty() && !page.refreshing) item { EmptyState("No files here yet", if (more) "Look through more notes, or choose another channel." else "Try another channel or file filter.") }
            if (more) item {
                NotedOutlinedButton({
                    emptyPages = 0
                    advance()
                }, enabled = !page.refreshing && page.obj != null, modifier = Modifier.fillMaxWidth()) { Text("Load more files") }
            }
        }
    }
}
