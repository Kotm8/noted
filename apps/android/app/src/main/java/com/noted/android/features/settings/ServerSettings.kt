package com.noted.android.features.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*

@Composable
fun SessionSettings(repository: NativeRepository) {
    val resource = rememberResource(repository, "/auth/sessions")
    val actions = rememberActions()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp)) {
        item { Text("Active sessions", style = MaterialTheme.typography.titleLarge); ResourceStatus(resource) { repository.changed() } }
        items(resource.rows, key = { it.text("id") }) { session ->
            NotedListItem(headlineContent = { Text(if (session.optBoolean("is_current")) "This Android app" else session.text("user_agent", "Another device"), maxLines = 2) },
                supportingContent = { Text("Last active: ${session.text("last_seen_at").take(16).replace('T', ' ')}") },
                trailingContent = { ActionIcon(NotedIcons.Logout, "Sign out this session", !actions.busy) { actions.run {
                    if (session.optBoolean("is_current")) repository.logout()
                    else repository.mutate("/auth/sessions/${session.text("id")}", "DELETE")
                } } })
        }
    }
}

@Composable
fun ServerSettings(repository: NativeRepository) {
    val session by repository.session.collectAsStateWithLifecycle()
    val resource = rememberResource(repository, "/settings/server")
    val updates = rememberResource(repository, "/updates/status")
    val actions = rememberActions()
    var password by remember { mutableStateOf(false) }
    var logout by remember { mutableStateOf(false) }
    var update by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(resource.obj?.text("server_name") ?: "Your server", style = MaterialTheme.typography.titleLarge)
            Text(session?.origin.orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            ResourceStatus(resource) { repository.changed() }
            Text("Server version ${resource.obj?.text("version").orEmpty()}")
            Text("Access: Owner only")
            SectionTitle("Server updates")
            ResourceStatus(updates) { repository.changed() }
            val status = updates.obj
            val latest = status?.optJSONObject("latest")
            if (latest != null && status.optBoolean("available")) {
                Text("${latest.text("version")} is available", style = MaterialTheme.typography.titleMedium)
                Markdown(latest.text("notes"))
                NotedButton(onClick = { update = true }, enabled = !actions.busy) { Text("Update server") }
            }
            status?.optJSONObject("job")?.let { Text("${it.text("phase")}: ${it.text("detail")}") }
            NotedOutlinedButton(onClick = { actions.run { repository.mutate("/updates/check") } }, enabled = !actions.busy) { Text("Check for updates") }
            SectionTitle("Account")
            NotedOutlinedButton(onClick = { password = true }) { Text("Change password") }
            NotedOutlinedButton(onClick = { logout = true }) { Text("Switch server or sign out") }
            QuietNotice("Signing out removes this account's cached content and drafts from this phone.")
        }
    }
    if (update) EditorSheet("Update your server?", { update = false }, "Install update", save = {
        val release = updates.obj!!.getJSONObject("latest")
        repository.mutate("/updates/apply", body = json("commit" to release.text("commit"), "manifest_sha256" to release.text("manifest_sha256")))
    }) { Text("Noted may be briefly unavailable while the update is installed.") }
    if (logout) EditorSheet("Sign out?", { logout = false }, "Sign out", save = { repository.logout() }) {
        Text("Any unsent messages or local drafts on this phone will be removed. Notes already saved to your server are kept.")
    }
    if (password) {
        var old by remember { mutableStateOf("") }; var new by remember { mutableStateOf("") }
        EditorSheet("Change password", { password = false }, save = {
            repository.mutate("/settings/password", "PUT", json("current_password" to old, "new_password" to new)); old = ""; new = ""
        }) {
            PasswordField("Current password", old) { old = it }
            PasswordField("New password", new) { new = it }
        }
    }
}

@Composable
fun PasswordField(label: String, value: String, change: (String) -> Unit) {
    NotedTextField(value, change, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text(label) },
        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
}
