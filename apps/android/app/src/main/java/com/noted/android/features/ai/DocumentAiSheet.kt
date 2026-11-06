package com.noted.android.features.ai

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentAiSheet(repository: NativeRepository, source: JSONObject, close: () -> Unit, apply: suspend (String) -> Unit) {
    var instructions by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("answer") }
    var output by remember { mutableStateOf("") }
    var completed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var sources by remember { mutableStateOf(emptyList<JSONObject>()) }
    var history by remember { mutableStateOf(emptyList<JSONObject>()) }
    val actions = rememberActions()
    val scope = rememberCoroutineScope()
    val prompts = rememberResource(repository, "/ai/prompts")
    var selectedPrompt by remember { mutableStateOf("") }
    NotedSheet(close, title = "Ask AI about ${source.text("title").ifBlank { "this note" }}", sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.9f).imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Choice("Saved prompt", selectedPrompt, listOf("" to "Custom instructions") + prompts.rows.filter { it.optJSONArray("places")?.toString()?.contains(source.text("place")) == true }.map { it.text("id") to it.text("name") }) { id ->
                if (!busy) {
                    selectedPrompt = id
                    prompts.rows.firstOrNull { it.text("id") == id }?.let { instructions = it.text("instructions"); kind = it.text("kind") }
                }
            }
            Choice("Action", kind, listOf("answer" to "Ask a question", "rewrite" to "Rewrite", "draft" to "Draft")) { if (!busy) { kind = it; selectedPrompt = ""; completed = false } }
            history.takeLast(8).forEach { turn -> Markdown(turn.text("content")) }
            Field("Instructions", instructions, { if (!busy) { instructions = it.take(4000); selectedPrompt = "" } }, singleLine = false)
            NotedButton({
                busy = true; completed = false; failure = null; output = ""
                val question = instructions
                val request = json("instructions" to question, "kind" to kind, "place" to source.text("place"), "channel_id" to source.text("channel_id"),
                    "text" to source.text("content").ifBlank { "Title: ${source.text("title")}" }, "where" to source.text("title"), "history" to org.json.JSONArray(history.takeLast(18)))
                if (selectedPrompt.isNotBlank()) request.put("prompt_id", selectedPrompt)
                scope.launch {
                    try {
                        repository.api.stream("/ai/runs", request).collect { event ->
                            when (event.text("type")) {
                                "text" -> output = event.text("text")
                                "sources" -> sources = event.rows("sources")
                                "error" -> error(event.text("message"))
                                "done" -> { output = event.text("output"); completed = true; sources = event.rows("sources").ifEmpty { sources } }
                            }
                        }
                        check(completed) { "The response was interrupted. Your writing is unchanged." }
                        history = (history + json("role" to "user", "content" to question) + json("role" to "assistant", "content" to output)).takeLast(18)
                        repository.changed("settings")
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) { failure = error.message }
                    finally { busy = false }
                }
            }, enabled = instructions.isNotBlank() && !busy && !actions.busy) { Text(if (busy) "Working…" else "Ask AI") }
            failure?.let { QuietNotice(it, true) }
            if (completed && kind in listOf("rewrite", "draft")) {
                Field("Review before applying", output, { output = it }, singleLine = false)
                NotedButton({ actions.run { apply(output); close() } }, enabled = output.isNotBlank() && !actions.busy && !busy) { Text("Apply to note") }
            } else Markdown(output)
            AiSources(repository, sources)
        }
    }
}
