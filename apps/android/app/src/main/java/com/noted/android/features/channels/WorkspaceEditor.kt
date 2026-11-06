package com.noted.android.features.channels

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import android.net.Uri
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun WorkspaceEditor(repository: NativeRepository, item: JSONObject, close: () -> Unit) {
    var type by remember { mutableStateOf(item.text("type", "channel")) }
    var name by remember { mutableStateOf(item.text("name")) }
    var icon by remember { mutableStateOf(item.text("icon", "N")) }
    var kind by remember { mutableStateOf(item.text("kind", "note")) }
    var category by remember { mutableStateOf(item.text("category_id")) }
    var deleting by remember { mutableStateOf(false) }
    var image by remember { mutableStateOf<Uri?>(null) }
    var imageChanged by remember { mutableStateOf(false) }
    var createdId by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val categories = rememberResource(repository, item.text("workspace_id").takeIf { it.isNotBlank() }?.let { "/workspaces/$it/categories?limit=200" })
    val id = item.text("id")
    val path = when (type) {
        "workspace" -> "/workspaces"
        "category" -> "/workspaces/${item.text("workspace_id")}/categories"
        else -> "/workspaces/${item.text("workspace_id")}/channels"
    }
    val editPath = when (type) { "workspace" -> "/workspaces/$id"; "category" -> "/categories/$id"; else -> "/channels/$id" }
    if (deleting) {
        ConfirmDelete("Delete $name?", { deleting = false }) {
            repository.mutate(editPath, "DELETE"); close()
        }
        return
    }
    EditorSheet(if (id.isBlank()) "Add ${if (type == "workspace") "project" else type}" else "$name settings", close,
        enabled = name.isNotBlank(), save = {
            val fields = json("name" to name.trim(), "position" to item.optInt("position"))
            if (type == "workspace") fields.put("icon", icon.ifBlank { "N" })
            if (type == "channel") fields.put("kind", kind).put("category_id", category.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
            val effectiveId = createdId ?: id
            val destination = if (effectiveId.isBlank()) path else if (type == "workspace") "/workspaces/$effectiveId" else editPath
            val saved = JSONObject(repository.mutate(destination, if (effectiveId.isBlank()) "POST" else "PUT", fields))
            if (type == "workspace") {
                createdId = saved.text("id")
                if (imageChanged) {
                    val iconPath = "/workspaces/${saved.text("id")}/icon"
                    if (image != null) repository.api.uploadFile(context, iconPath, image!!, "PUT")
                    else repository.mutate(iconPath, "DELETE")
                    repository.changed("structure")
                }
            }
        }) {
        if (id.isBlank() && type != "workspace") Choice("Create", type, listOf("channel" to "Channel", "category" to "Category")) { type = it }
        Field("Name", name, { name = it })
        if (type == "workspace") WorkspaceIconPicker(repository, icon, image, item.text("icon_url").takeUnless { imageChanged },
            chooseIcon = { icon = it; image = null; imageChanged = true }, chooseImage = { image = it; imageChanged = true })
        if (type == "channel") {
            Choice("Type", kind, listOf("note" to "Chat", "reminder" to "Reminders", "journal" to "Journal", "document" to "Notes", "tasks" to "Tasks")) { kind = it }
            Choice("Category", category, listOf("" to "No category") + categories.rows.map { it.text("id") to it.text("name") }) { category = it }
            if (id.isNotBlank()) {
                val actions = rememberActions()
                NotedTextButton(onClick = { actions.run { repository.mutate("/channels/$id/pin", "PUT", json("pinned" to item.text("pinned_at").isBlank())) } }, enabled = !actions.busy) {
                    Text(if (item.text("pinned_at").isBlank()) "Pin to Home" else "Unpin from Home")
                }
            }
        }
        if (id.isNotBlank()) NotedTextButton(onClick = { deleting = true }) { Text("Delete ${if (type == "workspace") "project" else type}", color = MaterialTheme.colorScheme.error) }
    }
}
