package com.noted.android.features.ai

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.material3.Icon
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun AiSources(repository: NativeRepository, sources: List<JSONObject>) {
    val context = LocalContext.current
    val navigate = LocalNotedNavigate.current
    var expanded by remember { mutableStateOf(false) }
    val unique = sources.distinctBy { it.text("url") }
    if (unique.isNotEmpty()) Column {
        NotedTextButton({ expanded = !expanded }) {
            Text("${unique.size} ${if (unique.size == 1) "source" else "sources"}")
            Icon(if (expanded) NotedIcons.ChevronUp else NotedIcons.ChevronDown, null, Modifier.padding(start = 6.dp).size(16.dp))
        }
        if (expanded) unique.forEach { source ->
            val raw = source.text("url")
            val url = if (raw.startsWith('/') && !raw.startsWith("//")) repository.api.origin + raw else raw
            NotedTextButton({
                val uri = Uri.parse(url)
                if (repository.api.sameOrigin(url)) notedRoute(uri)?.let(navigate)
                else if (uri.scheme in listOf("https", "http")) context.startActivity(Intent(Intent.ACTION_VIEW, uri))
            }, Modifier.fillMaxWidth()) { Text(source.text("title").ifBlank { raw }, maxLines = 2) }
        }
    }
}
