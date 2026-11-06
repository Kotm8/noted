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
fun ActivitySettings(repository: NativeRepository) {
    val resource = rememberResource(repository, "/time-tracking/activities")
    var edit by remember { mutableStateOf<JSONObject?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp)) {
        item { Text("Activities", style = MaterialTheme.typography.titleLarge); ResourceStatus(resource) { repository.changed() } }
        items(resource.rows.filter { !it.optBoolean("archived") }, key = { it.text("id") }) { activity ->
            NotedListItem(headlineContent = { Text(activity.text("name")) }, leadingContent = { Icon(NotedIcons.Circle, null, tint = color(activity.text("color"))) },
                trailingContent = { Icon(NotedIcons.Edit, null) }, modifier = Modifier.clickable { edit = activity })
        }
        item { NotedOutlinedButton(onClick = { edit = JSONObject() }, modifier = Modifier.fillMaxWidth()) { Icon(NotedIcons.Add, null); Text("Add activity") } }
    }
    edit?.let { activity ->
        var name by remember { mutableStateOf(activity.text("name")) }
        var icon by remember { mutableStateOf(activity.text("icon", "Activity")) }
        var activityColor by remember { mutableStateOf(activity.text("color", "#9db9ce")) }
        var archive by remember { mutableStateOf(activity.optBoolean("archived")) }
        var nudge by remember { mutableStateOf(activity.optJSONObject("writing_nudge") != null) }
        val channels = rememberResource(repository, "/channels")
        var nudgeChannel by remember { mutableStateOf(activity.optJSONObject("writing_nudge")?.text("channel_id").orEmpty()) }
        var interval by remember { mutableStateOf((activity.optJSONObject("writing_nudge")?.optInt("interval_minutes", 30) ?: 30).toString()) }
        EditorSheet(if (activity.text("id").isBlank()) "New activity" else "Edit activity", { edit = null }, enabled = name.isNotBlank(), save = {
            val fields = json("name" to name, "icon" to icon, "color" to activityColor,
                "writing_nudge" to if (nudge) json("enabled" to true, "channel_id" to nudgeChannel, "interval_minutes" to (interval.toIntOrNull() ?: 30)) else null)
            val id = activity.text("id")
            if (id.isNotBlank()) fields.put("revision", activity.optInt("revision")).put("archived", archive).put("position", activity.optInt("position"))
            repository.mutate(if (id.isBlank()) "/time-tracking/activities" else "/time-tracking/activities/$id", if (id.isBlank()) "POST" else "PUT", fields)
        }) {
            Field("Name", name, { name = it })
            Choice("Icon", icon, listOf("Activity", "Code2", "BookOpen", "BriefcaseBusiness", "Trees", "Coffee", "Laptop", "Moon", "Sun", "Flag").map { it to it }) { icon = it }
            Choice("Color", activityColor, listOf("#9db9ce" to "Blue", "#e2c15a" to "Yellow", "#b8cc9b" to "Green", "#c1acd4" to "Lavender", "#dba58b" to "Peach")) { activityColor = it }
            Toggle("Writing nudges", nudge) { nudge = it }
            if (nudge) {
                Choice("Write in", nudgeChannel, channels.rows.map { it.text("id") to it.text("name") }) { nudgeChannel = it }
                Field("Every tracked minutes", interval, { interval = it })
            }
            if (activity.text("id").isNotBlank()) Toggle("Archived", archive) { archive = it }
        }
    }
}
