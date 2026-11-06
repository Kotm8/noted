package com.noted.android.features.ai

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssistantChats(repository: NativeRepository, close: () -> Unit, select: (String, List<JSONObject>) -> Unit) {
    val chats = rememberResource(repository, "/ai/assistant/chats")
    val actions = rememberActions()
    var removing by remember { mutableStateOf<String?>(null) }
    NotedSheet(close, title = "Conversations") {
        LazyColumn(Modifier.fillMaxWidth().fillMaxHeight(.75f), contentPadding = PaddingValues(16.dp)) {
            item { ResourceStatus(chats) { repository.changed() } }
            items(chats.rows, key = { it.text("id") }) { chat ->
                NotedListItem(headlineContent = { Text(chat.text("title")) }, supportingContent = { Text(chat.text("updated_at").take(16).replace('T', ' ')) },
                    trailingContent = { ActionIcon(NotedIcons.DeleteOutline, "Delete conversation") { removing = chat.text("id") } },
                    modifier = Modifier.clickable(enabled = !actions.busy) { actions.run {
                        val turns = org.json.JSONArray(repository.fetch("/ai/assistant/chats/${chat.text("id")}")).objects()
                        select(chat.text("id"), turns); close()
                    } })
            }
            if (chats.rows.isEmpty()) item { QuietNotice("Conversations you save with Noted appear here.") }
        }
    }
    removing?.let { id -> ConfirmDelete("Delete this conversation?", { removing = null }) { repository.mutate("/ai/assistant/chats/$id", "DELETE"); removing = null } }
}
