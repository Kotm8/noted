package com.noted.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun AppearanceSettings(repository: NativeRepository) {
    val resource = rememberResource(repository, "/settings/appearance")
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    val value = (resource.obj ?: defaultAppearance()).copy().apply {
        draft?.let { changes -> changes.keys().forEach { key -> put(key, changes.opt(key)) } }
    }
    val actions = rememberActions()
    fun set(key: String, item: Any) { draft = (draft ?: JSONObject()).copy().put(key, item) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Appearance", style = MaterialTheme.typography.titleLarge)
        ResourceStatus(resource) { repository.changed() }
        Choice("Theme", value.text("preset", "modern"), appearancePresets.map { it.key to it.value.name }) {
            val preset = applyAppearancePreset(value, it)
            draft = (draft ?: JSONObject()).copy().apply {
                listOf("preset", "background", "sidebar", "text", "accent").forEach { key -> put(key, preset.opt(key)) }
            }
        }
        SectionTitle("Accent")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("#e2c15a", "#dba58b", "#b8cc9b", "#9db9ce", "#c1acd4", "#df9d96").forEach { hex ->
                Box(Modifier.size(38.dp).background(color(hex), CircleShape).clickable { set("accent", hex) })
            }
        }
        Field("Accent color", value.text("accent"), { set("accent", it) })
        Field("Background", value.text("background"), { set("background", it) })
        Field("Sidebar", value.text("sidebar"), { set("sidebar", it) })
        Field("Text color", value.text("text"), { set("text", it) })
        Text("Text size: ${value.optInt("textSize", 15)}")
        NotedSlider(value.optInt("textSize", 15).toFloat(), { set("textSize", it.toInt()) }, valueRange = 12f..20f, steps = 7)
        Text("Interface zoom: ${value.optInt("zoom", 100)}%")
        NotedSlider(value.optInt("zoom", 100).toFloat(), { set("zoom", it.toInt()) }, valueRange = 75f..150f, steps = 14)
        Choice("Message layout", value.text("messageLayout", "minute"), listOf("minute" to "Minute markers", "connected" to "Connected notes", "quiet" to "Quiet timestamps", "rows" to "Individual rows")) { set("messageLayout", it) }
        Text("Group notes within ${value.optInt("messageGroupMinutes", 2)} minutes")
        NotedSlider(value.optInt("messageGroupMinutes", 2).toFloat(), { set("messageGroupMinutes", it.toInt()) }, valueRange = 1f..30f, steps = 28)
        val valid = listOf("background", "sidebar", "text", "accent").all { value.text(it).matches(Regex("#[0-9a-fA-F]{6}")) }
        NotedButton(onClick = { actions.run {
            repository.saveAppearance(draft!!.copy())
            draft = null
        } }, modifier = Modifier.fillMaxWidth(), enabled = !actions.busy && valid && draft != null) { Text("Save appearance") }
        QuietNotice("Appearance preferences are shared with your other devices. Android also respects your system font scaling.")
    }
}
