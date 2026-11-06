package com.noted.android.features.search

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.noted.android.data.NativeRepository
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun SearchPanel(repository: NativeRepository, channels: List<JSONObject>, close: () -> Unit, open: (String) -> Unit) {
    Dialog(close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Column(Modifier.width((maxWidth - 12.dp).coerceAtMost(400.dp)).fillMaxHeight().align(Alignment.CenterEnd)
                .background(NotedStyle.colors.sidebar).safeDrawingPadding()) {
                Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Search", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    ActionIcon(NotedIcons.Close, "Close search", action = close)
                }
                HorizontalDivider(color = NotedStyle.colors.subtle)
                SearchScreen(repository, false, channels, open)
            }
        }
    }
}
