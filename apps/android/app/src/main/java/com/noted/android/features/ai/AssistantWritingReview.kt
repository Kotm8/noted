package com.noted.android.features.ai

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun AssistantWritingReview(proposal: JSONObject, originals: Map<String, String>, selected: Set<String>, enabled: Boolean,
    select: (Set<String>) -> Unit, copy: (String) -> Unit, openReply: (JSONObject) -> Unit) {
    proposal.rows("rewrites").forEachIndexed { index, change ->
        val key = "rewrites-$index"
        Row(verticalAlignment = Alignment.Top) {
            NotedCheckbox(key in selected, if (enabled) { checked -> select(if (checked) selected + key else selected - key) } else null)
            Column(Modifier.weight(1f).padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Rewrite message", style = MaterialTheme.typography.titleSmall)
                originals[change.text("id")]?.let { Text("Current text", style = MaterialTheme.typography.labelSmall); Markdown(it) }
                Text("Suggested text", style = MaterialTheme.typography.labelSmall)
                Markdown(change.text("text"))
            }
        }
    }
    proposal.optJSONObject("posted")?.let { posted ->
        NotedTextButton({ openReply(posted) }) { Text("Open posted thread reply") }
    }
    proposal.text("draft").takeIf { it.isNotBlank() }?.let { draft ->
        SectionTitle("Draft message")
        Markdown(draft)
        NotedOutlinedButton({ copy(draft) }) {
            Icon(NotedIcons.ContentCopy, null, Modifier.size(16.dp))
            Text("Copy draft", Modifier.padding(start = 8.dp))
        }
    }
}
