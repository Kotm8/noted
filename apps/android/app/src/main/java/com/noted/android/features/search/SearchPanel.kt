package com.noted.android.features.search

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.noted.android.data.NativeRepository
import com.noted.android.ui.NotedStyle
import org.json.JSONObject

@Composable
fun SearchPanel(repository: NativeRepository, channels: List<JSONObject>, close: () -> Unit, open: (String) -> Unit) {
    Dialog(close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(NotedStyle.colors.main).systemBarsPadding().imePadding()) {
            CompositionLocalProvider(LocalContentColor provides NotedStyle.colors.text) { SearchScreen(repository, false, channels, open, close) }
        }
    }
}
