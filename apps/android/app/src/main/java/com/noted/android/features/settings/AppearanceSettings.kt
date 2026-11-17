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
        fun profile(style: String, mode: String) { draft = selectAppearanceProfile(value, style, mode) }
        Choice("Profile", value.text("style", "modern"), listOf("modern" to "Modern", "comic" to "Comic", "snow" to "Snow", "stars" to "Stars")) { profile(it, value.text("mode", "dark")) }
        Choice("Mode", value.text("mode", "dark"), listOf("dark" to "Dark", "light" to "Light")) { profile(value.text("style", "modern"), it) }
        val savedThemes = value.optJSONObject("savedThemes") ?: JSONObject()
        if (savedThemes.length() > 0) Choice("Saved theme", "", listOf("" to "Choose a theme") + savedThemes.keys().asSequence().map { it to it }.toList()) { name ->
            savedThemes.optJSONObject(name)?.let { draft = it.copy().put("savedThemes", savedThemes) }
        }
        var themeName by remember { mutableStateOf("") }
        Field("Theme name", themeName, { themeName = it.take(60) })
        NotedOutlinedButton(enabled = themeName.isNotBlank() && savedThemes.length() < 20, onClick = {
            val theme = value.copy().apply { remove("savedThemes") }
            set("savedThemes", savedThemes.copy().put(themeName.trim(), theme))
            themeName = ""
        }) { Text("Save a copy") }
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
        val extraColors = value.optJSONObject("colors") ?: JSONObject()
        listOf("header" to "Header", "rail" to "Project rail", "input" to "Inputs", "floating" to "Panels", "selected" to "Selected", "headings" to "Headings", "textSecondary" to "Secondary text", "border" to "Borders").forEach { (key, label) ->
            Field(label, extraColors.text(key), { set("colors", extraColors.copy().put(key, it)) })
        }
        Choice("Density", value.text("density", "comfortable"), listOf("compact" to "Compact", "comfortable" to "Comfortable", "spacious" to "Spacious")) { set("density", it) }
        Choice("Font", value.text("font", "system"), listOf("system" to "System", "sans" to "Sans", "serif" to "Serif", "mono" to "Monospace")) { set("font", it) }
        Choice("Code font", value.text("codeFont", "system"), listOf("system" to "System", "consolas" to "Consolas", "courier" to "Courier")) { set("codeFont", it) }
        Text("Line height: ${value.optDouble("lineHeight", 1.6)}")
        NotedSlider(value.optDouble("lineHeight", 1.6).toFloat(), { set("lineHeight", (it * 10).toInt() / 10.0) }, valueRange = 1.2f..2f, steps = 7)
        Text("Reading width: ${value.optInt("readingWidth", 960)} px")
        NotedSlider(value.optInt("readingWidth", 960).toFloat(), { set("readingWidth", it.toInt()) }, valueRange = 480f..1600f, steps = 27)
        Toggle("Reduce motion", value.optBoolean("reducedMotion")) { set("reducedMotion", it) }
        Toggle("Stronger borders and focus", value.optBoolean("highContrast")) { set("highContrast", it) }
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
