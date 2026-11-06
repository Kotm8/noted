package com.noted.android.features.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.noted.android.BuildConfig
import com.noted.android.data.*
import com.noted.android.ui.*

private val phoneSections = listOf("appearance" to "Appearance", "notifications" to "Notifications",
    "activities" to "Activities", "watch" to "Watch", "server" to "Server")

/** Web settings sections, opened with `?settings=` because the phone leaves their editing to the web. */
private val webSections = listOf("tracking" to "Calendar and work days", "templates" to "Templates", "ai" to "AI",
    "ai-prompts" to "Saved prompts", "backups" to "Backups", "devices" to "Devices and sessions")

@Composable
fun SettingsScreen(repository: NativeRepository, section: String, open: (String) -> Unit) {
    val context = LocalContext.current
    val origin = repository.session.collectAsState().value?.origin
    if (section.isBlank()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp)) {
            phoneSections.forEach { (path, name) ->
                item {
                    NotedListItem(headlineContent = { Text(name) }, trailingContent = { Icon(NotedIcons.ChevronRight, null) },
                        modifier = Modifier.clickable { open("settings/$path") })
                }
            }
            if (origin != null) {
                item { SectionTitle("On the web") }
                webSections.forEach { (path, name) ->
                    item {
                        NotedListItem(headlineContent = { Text(name) },
                            trailingContent = { Icon(NotedIcons.ExternalLink, "Opens in your browser", Modifier.size(18.dp)) },
                            modifier = Modifier.clickable { openOnWeb(context, origin, "/home?settings=$path") })
                    }
                }
            }
            item { QuietNotice("Noted ${BuildConfig.VERSION_NAME} · Native Android") }
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        NotedTextButton(onClick = { open("settings") }) { Icon(NotedIcons.ArrowBack, null); Text("Settings") }
        when (section) {
            "appearance" -> AppearanceSettings(repository)
            "notifications" -> NotificationSettings(repository)
            "activities" -> ActivitySettings(repository)
            "schedule" -> ScheduleSettings(repository)
            "templates" -> TemplateSettings(repository)
            "ai" -> AiSettings(repository)
            "watch" -> WatchSettings(repository)
            "sessions" -> SessionSettings(repository)
            "backups" -> BackupSettings(repository)
            "server" -> ServerSettings(repository)
        }
    }
}
