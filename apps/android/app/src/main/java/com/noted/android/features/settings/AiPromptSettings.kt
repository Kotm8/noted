package com.noted.android.features.settings

import androidx.compose.foundation.clickable
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

@Composable
fun AiPromptSettings(repository: NativeRepository) {
    val prompts = rememberResource(repository, "/ai/prompts")
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp)) {
        item { Text("Saved prompts", style = MaterialTheme.typography.titleLarge); ResourceStatus(prompts) { repository.changed() } }
        items(prompts.rows, key = { it.text("id") }) { prompt ->
            NotedListItem(headlineContent = { Text(prompt.text("name")) }, supportingContent = { Text(prompt.text("instructions"), maxLines = 2) },
                trailingContent = { Icon(NotedIcons.Edit, null) }, modifier = Modifier.clickable { editing = prompt })
        }
        item { NotedOutlinedButton({ editing = JSONObject() }, Modifier.fillMaxWidth()) { Text("New saved prompt") } }
    }
    editing?.let { prompt ->
        var name by remember { mutableStateOf(prompt.text("name")) }
        var instructions by remember { mutableStateOf(prompt.text("instructions")) }
        var kind by remember { mutableStateOf(prompt.text("kind", "answer")) }
        var sees by remember { mutableStateOf(prompt.text("sees", "selection")) }
        var places by remember { mutableStateOf(prompt.optJSONArray("places")?.let { rows -> (0 until rows.length()).map { rows.getString(it) }.toSet() } ?: setOf("messages")) }
        var model by remember { mutableStateOf(prompt.text("model")) }
        var removing by remember { mutableStateOf(false) }
        val id = prompt.text("id")
        if (removing) ConfirmDelete("Delete this prompt?", { removing = false }) { repository.mutate("/ai/prompts/$id", "DELETE"); editing = null }
        else EditorSheet(if (id.isBlank()) "New saved prompt" else "Edit saved prompt", { editing = null }, enabled = name.isNotBlank() && instructions.isNotBlank() && places.isNotEmpty(), save = {
            val fields = json("name" to name, "instructions" to instructions, "kind" to kind, "sees" to sees, "places" to JSONArray(places.toList()), "model" to model.takeIf { it.isNotBlank() })
            if (id.isNotBlank()) fields.put("revision", prompt.optInt("revision"))
            repository.mutate(if (id.isBlank()) "/ai/prompts" else "/ai/prompts/$id", if (id.isBlank()) "POST" else "PUT", fields)
        }) {
            Field("Name", name, { name = it.take(60) }); Field("Instructions", instructions, { instructions = it.take(4000) }, singleLine = false)
            Choice("Action", kind, listOf("answer" to "Answer", "rewrite" to "Rewrite", "reply" to "Reply", "draft" to "Draft")) { kind = it }
            Choice("Context", sees, listOf("selection" to "Selected note", "channel_today" to "Today's channel notes")) { sees = it }
            listOf("messages" to "Messages", "journals" to "Journals", "documents" to "Notes", "composer" to "Composer").forEach { (key, label) ->
                Toggle(label, key in places) { places = if (it) places + key else places - key }
            }
            Field("Model override, optional", model, { model = it.take(80) })
            if (id.isNotBlank()) NotedTextButton({ removing = true }) { Text("Delete prompt", color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
fun AiMemories(repository: NativeRepository) {
    val memories = rememberResource(repository, "/ai/memories")
    val actions = rememberActions()
    var removing by remember { mutableStateOf<JSONObject?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp)) {
        item { Text("AI memory", style = MaterialTheme.typography.titleLarge); ResourceStatus(memories) { repository.changed() } }
        items(memories.rows, key = { it.text("id") }) { memory ->
            NotedListItem(headlineContent = { Text(memory.text("text")) }, trailingContent = {
                ActionIcon(NotedIcons.DeleteOutline, "Forget this memory") { removing = memory }
            })
        }
        if (memories.rows.isEmpty()) item { QuietNotice("No saved memories.") }
    }
    removing?.let { memory -> ConfirmDelete("Forget this memory?", { removing = null }) { repository.mutate("/ai/memories/${memory.text("id")}", "DELETE"); removing = null } }
}
