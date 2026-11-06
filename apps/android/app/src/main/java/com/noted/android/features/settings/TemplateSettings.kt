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
import org.json.JSONObject

@Composable
fun TemplateSettings(repository: NativeRepository) {
    val notes = rememberResource(repository, "/templates/notes")
    val days = rememberResource(repository, "/templates/days")
    var edit by remember { mutableStateOf<JSONObject?>(null) }
    val actions = rememberActions()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp)) {
        item { Text("Templates", style = MaterialTheme.typography.titleLarge); SectionTitle("Notes") }
        items(notes.rows, key = { "note-${it.text("id")}" }) { template ->
            NotedListItem(headlineContent = { Text(template.text("name")) }, trailingContent = { Icon(NotedIcons.Edit, null) },
                modifier = Modifier.clickable { edit = template.copy().put("type", "notes") })
        }
        item { NotedOutlinedButton(onClick = { edit = json("type" to "notes") }, modifier = Modifier.fillMaxWidth()) { Text("New note template") }; SectionTitle("Days") }
        items(days.rows, key = { "day-${it.text("id")}" }) { template ->
            NotedListItem(headlineContent = { Text(template.text("name")) }, supportingContent = { Text("${template.rows("blocks").size} activities") },
                trailingContent = { ActionIcon(NotedIcons.DeleteOutline, "Delete template", !actions.busy) { actions.run {
                    repository.mutate("/templates/days/${template.text("id")}?revision=${template.optInt("revision")}", "DELETE")
                } } })
        }
        item { QuietNotice("Create day templates from the Template button below a date in Calendar.") }
    }
    edit?.let { template ->
        var name by remember { mutableStateOf(template.text("name")) }
        var content by remember { mutableStateOf(template.text("content")) }
        var deleting by remember { mutableStateOf(false) }
        val id = template.text("id")
        if (deleting) ConfirmDelete("Delete template?", { deleting = false }) {
            repository.mutate("/templates/notes/$id?revision=${template.optInt("revision")}", "DELETE"); edit = null
        } else EditorSheet(if (id.isBlank()) "New note template" else "Edit template", { edit = null }, enabled = name.isNotBlank(), save = {
            val body = json("name" to name, "content" to content)
            if (id.isNotBlank()) body.put("revision", template.optInt("revision"))
            repository.mutate(if (id.isBlank()) "/templates/notes" else "/templates/notes/$id", if (id.isBlank()) "POST" else "PUT", body)
        }) {
            Field("Name", name, { name = it }); Field("Markdown", content, { content = continueTask(content, it) }, singleLine = false)
            if (id.isNotBlank()) NotedTextButton(onClick = { deleting = true }) { Text("Delete template", color = MaterialTheme.colorScheme.error) }
        }
    }
}
