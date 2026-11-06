package com.noted.android.features.settings

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun AiSettings(repository: NativeRepository) {
    var page by remember { mutableStateOf("") }
    if (page.isNotBlank()) {
        Column(Modifier.fillMaxSize()) {
            NotedTextButton({ page = "" }) { Text("Back to AI") }
            when (page) {
                "prompts" -> AiPromptSettings(repository)
                "history" -> AiHistory(repository)
                "memory" -> AiMemories(repository)
            }
        }
        return
    }
    val status = rememberResource(repository, "/ai/status")
    val preferences = rememberResource(repository, "/ai/preferences")
    val models = rememberResource(repository, if (status.obj?.optBoolean("connected") == true) "/ai/models" else null)
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var auth by remember { mutableStateOf("") }
    var signingIn by remember { mutableStateOf(false) }
    var returnAddress by remember { mutableStateOf("") }
    val context = LocalContext.current
    val value = draft ?: preferences.obj
    val actions = rememberActions()
    val authFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) actions.run {
            auth = withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    val bytes = ByteArray(20_001)
                    var size = 0
                    while (size < bytes.size) {
                        val count = input.read(bytes, size, bytes.size - size)
                        if (count < 0) break
                        size += count
                    }
                    require(size <= 20_000) { "Choose an auth JSON no larger than 20 KB." }
                    String(bytes, 0, size, Charsets.UTF_8)
                } ?: error("Choose the auth file again.")
            }
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("AI", style = MaterialTheme.typography.titleLarge)
        ResourceStatus(status) { repository.changed() }
        if (status.obj?.optBoolean("connected") == true) {
            Text("Connected: ${status.obj?.text("account").orEmpty()}")
            NotedOutlinedButton(onClick = { actions.run { repository.mutate("/ai/connection", "DELETE") } }, enabled = !actions.busy) { Text("Disconnect AI") }
        } else {
            Text("Connect ChatGPT to your server. The connection is shared with your other devices.")
            NotedButton({ actions.run {
                val url = JSONObject(repository.mutate("/ai/connection/sign-in")).text("url")
                require(Uri.parse(url).scheme == "https") { "The server returned an invalid sign-in address." }
                signingIn = true
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } }, enabled = !actions.busy) { Text("Sign in with ChatGPT") }
            if (signingIn) {
                QuietNotice("After signing in, the browser reaches a localhost page that cannot load. Copy that entire address and paste it here to finish.")
                Field("Return address", returnAddress, { returnAddress = it.take(4000) }, singleLine = false)
                NotedButton({ actions.run {
                    repository.mutate("/ai/connection/sign-in/finish", body = json("address" to returnAddress.trim()))
                    returnAddress = ""; signingIn = false
                } }, enabled = returnAddress.isNotBlank() && !actions.busy) { Text("Finish sign-in") }
            }
            SectionTitle("Or import an existing connection")
            NotedOutlinedButton({ authFile.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }) { Text("Choose auth JSON") }
            Field("Auth JSON", auth, { auth = it }, singleLine = false)
            NotedButton(onClick = { actions.run { repository.mutate("/ai/connection", body = json("auth_json" to auth)); auth = "" } }, enabled = auth.isNotBlank() && !actions.busy) { Text("Connect") }
        }
        if (value != null) {
            fun set(key: String, item: Any) { draft = value.copy().put(key, item) }
            Choice("Model", value.text("model"), models.rows.map { it.text("id") to it.text("name", it.text("id")) }.ifEmpty { listOf(value.text("model") to value.text("model")) }) { set("model", it) }
            Choice("Thinking", value.text("thinking", "medium"), listOf("low", "medium", "high", "xhigh").map { it to it }) { set("thinking", it) }
            Field("Writing preferences", value.text("standing_note"), { set("standing_note", it) }, singleLine = false)
            Field("Calendar preferences", value.text("calendar_note"), { set("calendar_note", it) }, singleLine = false)
            Toggle("Web search", value.optBoolean("web_search")) { set("web_search", it) }
            Toggle("Keep history", value.optBoolean("keep_history", true)) { set("keep_history", it) }
            Toggle("Nutrition tools", value.optBoolean("nutrition", true)) { set("nutrition", it) }
            Toggle("Remember useful preferences", value.optBoolean("memory")) { set("memory", it) }
            NotedButton(onClick = { actions.run { repository.mutate("/ai/preferences", "PUT", value); draft = null } }, enabled = draft != null && !actions.busy) { Text("Save AI preferences") }
        }
        SectionTitle("Manage")
        NotedOutlinedButton({ page = "prompts" }, Modifier.fillMaxWidth()) { Text("Saved prompts") }
        NotedOutlinedButton({ page = "history" }, Modifier.fillMaxWidth()) { Text("Writing history") }
        NotedOutlinedButton({ page = "memory" }, Modifier.fillMaxWidth()) { Text("AI memory") }
    }
}
