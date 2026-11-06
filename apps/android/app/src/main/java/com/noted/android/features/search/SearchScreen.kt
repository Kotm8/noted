package com.noted.android.features.search

import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable
fun SearchScreen(repository: NativeRepository, library: Boolean, channels: List<JSONObject>, open: (String) -> Unit) {
    if (library) { LibraryScreen(repository, channels, open); return }
    var query by rememberSaveable { mutableStateOf("") }
    var debounced by remember { mutableStateOf("") }
    var channel by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("newest") }
    var offset by remember { mutableIntStateOf(0) }
    LaunchedEffect(query) { delay(300); debounced = query.trim(); offset = 0 }
    val resource = rememberResource(repository, if (debounced.length >= 2)
        "/search?q=${Uri.encode(debounced)}&sort=$sort&offset=$offset&limit=30${if (channel.isNotBlank()) "&channel_id=$channel" else ""}" else null)
    Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
        Field("Search notes, journals, and documents", query, { query = it.take(200) })
        Choice("Search in", channel, listOf("" to "All channels") + channels.map { it.text("id") to it.text("name") }) { channel = it; offset = 0 }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${resource.obj?.optInt("total") ?: 0} results", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
            NotedTextButton(onClick = { sort = if (sort == "newest") "oldest" else "newest" }) {
                Icon(NotedIcons.Sort, null, Modifier.size(18.dp)); Text(if (sort == "newest") "Newest" else "Oldest")
            }
        }
        ResourceStatus(resource) { repository.changed() }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 12.dp)) {
                items(resource.obj?.rows("items").orEmpty(), key = { it.text("id") }) { result ->
                    NotedListItem(headlineContent = { Text(result.text("excerpt")) },
                        supportingContent = { Text("${result.text("workspace_name")} · #${result.text("channel_name")}") },
                        modifier = Modifier.clickable { open(searchRoute(result)) })
                }
                if (debounced.length < 2) item { EmptyState("Find something you wrote", "Search across your projects, channels, and journals.") }
                if (offset > 0 || (resource.obj?.optInt("total") ?: 0) > offset + 30) item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        NotedTextButton(enabled = offset > 0, onClick = { offset = (offset - 30).coerceAtLeast(0) }) { Text("Previous") }
                        NotedTextButton(enabled = (resource.obj?.optInt("total") ?: 0) > offset + 30, onClick = { offset += 30 }) { Text("Next") }
                    }
                }
        }
    }
}
