package com.noted.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.NativeRepository

@Composable
fun AccountTheme(repository: NativeRepository, content: @Composable () -> Unit) {
    val session by repository.session.collectAsStateWithLifecycle()
    val appearance = if (session != null) rememberResource(repository, "/settings/appearance").obj else null
    NotedTheme(appearance, content)
}

@Composable
fun ConnectionScreen(title: String, message: String?, busy: Boolean = false, error: Boolean = false,
    content: @Composable ColumnScope.() -> Unit = {}) {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.Center) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(title, style = MaterialTheme.typography.titleLarge)
            }
            Spacer(Modifier.height(16.dp))
            message?.let { QuietNotice(it, error) }
            content()
        }
    }
}
