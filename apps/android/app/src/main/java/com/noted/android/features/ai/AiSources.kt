package com.noted.android.features.ai

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun AiSources(repository: NativeRepository, sources: List<JSONObject>) {
    val context = LocalContext.current
    val navigate = LocalNotedNavigate.current
    if (sources.isNotEmpty()) Column {
        SectionTitle("Sources")
        sources.forEach { source ->
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
