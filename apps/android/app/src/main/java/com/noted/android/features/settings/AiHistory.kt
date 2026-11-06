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
fun AiHistory(repository: NativeRepository) {
    val history = rememberResource(repository, "/ai/runs?limit=500")
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var clear by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp)) {
        item { Text("Writing history", style = MaterialTheme.typography.titleLarge); ResourceStatus(history) { repository.changed() } }
        items(history.rows, key = { it.text("id") }) { run ->
            NotedListItem(headlineContent = { Text(run.text("prompt_name")) }, supportingContent = { Text("${run.text("where")} · ${run.text("created_at").take(16).replace('T', ' ')}") },
                modifier = Modifier.clickable { selected = run })
        }
        if (history.rows.isEmpty()) item { QuietNotice("Your saved writing runs appear here.") }
        else item { NotedTextButton({ clear = true }) { Text("Clear writing history", color = MaterialTheme.colorScheme.error) } }
    }
    if (clear) ConfirmDelete("Clear writing history?", { clear = false }) { repository.mutate("/ai/runs", "DELETE"); clear = false }
    selected?.let { run ->
        var removing by remember { mutableStateOf(false) }
        if (removing) ConfirmDelete("Delete this writing run?", { removing = false }) { repository.mutate("/ai/runs/${run.text("id")}", "DELETE"); selected = null }
        else EditorSheet(run.text("prompt_name"), { selected = null }, confirm = "Close", save = {}) {
            Text(run.text("instructions"))
            SectionTitle("Input")
            run.rows("input").forEach { Markdown(it.text("text")) }
            SectionTitle("Output")
            val output = run.opt("output")
            if (output is JSONArray) output.objects().forEach { Markdown(it.text("text")) }
            else Markdown(if (output == null || output == JSONObject.NULL) run.text("error", "No output") else output.toString())
            NotedTextButton({ removing = true }) { Text("Delete run", color = MaterialTheme.colorScheme.error) }
        }
    }
}
