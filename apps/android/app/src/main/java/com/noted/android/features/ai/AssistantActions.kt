package com.noted.android.features.ai

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.LocalDate

@Composable
fun AssistantActions(proposal: JSONObject, selected: Set<String>, enabled: Boolean, select: (Set<String>) -> Unit, change: (JSONObject) -> Unit) {
    listOf("posts", "deletions").forEach { group ->
        proposal.rows(group).forEachIndexed { index, item ->
            val key = "$group-$index"
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                NotedCheckbox(key in selected, if (enabled) { checked -> select(if (checked) selected + key else selected - key) } else null)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val target = item.optJSONObject(if (group == "posts") "destination" else "target")
                    if (group == "posts") {
                        val category = target?.text("category_name")?.takeIf { it.isNotBlank() }?.let { "$it / " }.orEmpty()
                        Text("Post to ${target?.text("workspace_name").orEmpty()} / $category#${target?.text("channel_name").orEmpty()}")
                        Markdown(item.text("text"))
                    } else {
                        Text("Delete ${item.text("kind")}: ${target?.text("title").orEmpty()}", color = NotedStyle.colors.danger)
                        target?.text("channel_name")?.takeIf { it.isNotBlank() }?.let { Text("${target.text("workspace_name")} / #$it", color = NotedStyle.colors.muted) }
                        if (item.text("kind") == "message") Text("Includes replies in this thread.", color = NotedStyle.colors.muted)
                        if (item.text("kind") == "plan" && target != null) {
                            val start = target.optInt("start_minute")
                            val end = target.optInt("end_minute")
                            val times = "%02d:%02d to %02d:%02d".format(start / 60, start % 60, end / 60, end % 60)
                            Text("${target.text("date")} / $times / ${target.text("timezone")}", color = NotedStyle.colors.muted)
                        }
                        target?.text("preview")?.takeIf { it.isNotBlank() }?.let { Markdown(it) }
                        if (enabled && item.text("kind") == "plan" && target?.text("frequency") != "none") {
                            fun update(scope: String, day: String = item.text("occurrence_date").ifBlank { target?.text("date").orEmpty() }) {
                                val revised = proposal.copy()
                                revised.getJSONArray("deletions").put(index, item.copy().put("scope", scope).put("occurrence_date", if (scope == "occurrence") day else JSONObject.NULL))
                                change(revised)
                            }
                            Choice("Delete recurring plan", item.text("scope"), listOf("" to "Choose what to delete", "occurrence" to "This occurrence", "series" to "Entire series")) { update(it) }
                            if (item.text("scope") == "occurrence") DateField("Occurrence", LocalDate.parse(item.text("occurrence_date").ifBlank { target?.text("date").orEmpty() })) { update("occurrence", it.toString()) }
                        }
                    }
                }
            }
        }
    }
}
