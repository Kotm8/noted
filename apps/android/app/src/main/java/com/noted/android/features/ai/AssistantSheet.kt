package com.noted.android.features.ai

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import com.noted.android.features.media.PhotoPicker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssistantSheet(repository: NativeRepository, open: Boolean, close: () -> Unit, message: JSONObject? = null) {
    var instructions by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var history by remember { mutableStateOf(emptyList<JSONObject>()) }
    var chatId by rememberSaveable { mutableStateOf<String?>(null) }
    var turnId by remember { mutableStateOf<String?>(null) }
    var sources by remember { mutableStateOf(emptyList<JSONObject>()) }
    var showChats by remember { mutableStateOf(false) }
    var photos by remember { mutableStateOf(emptyList<String>()) }
    var uploading by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var stage by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var busy by remember { mutableStateOf(false) }
    var applied by remember { mutableStateOf(false) }
    var applyBody by remember { mutableStateOf<JSONObject?>(null) }
    var applying by remember { mutableStateOf(false) }
    var loadingChat by remember { mutableStateOf(false) }
    var restoredChat by remember { mutableStateOf(false) }
    var context by remember { mutableStateOf(message?.let { json("channel_id" to it.text("channel_id"),
        "message_ids" to JSONArray(listOf(it.text("id"))), "thread_root_id" to it.opt("thread_root_id")) }) }
    var originals by remember { mutableStateOf(message?.let { mapOf(it.text("id") to it.text("content")) }.orEmpty()) }
    var selectedPrompt by remember { mutableStateOf("") }
    val prompts = rememberResource(repository, if (open && context != null) "/ai/prompts" else null)
    val clipboard = LocalClipboardManager.current
    val navigate = LocalNotedNavigate.current
    val scope = rememberCoroutineScope()
    val tracker = rememberResource(repository, if (open) "/time-tracking/tracker" else null)
    val preferences = tracker.obj?.optJSONObject("preferences")
    val timezone = preferences?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    var start by remember { mutableStateOf(LocalDate.now(ZoneId.of(timezone))) }
    var end by remember { mutableStateOf(start.plusDays(6)) }
    var proposalScope by remember { mutableStateOf<JSONObject?>(null) }
    suspend fun restoreConversation(id: String, turns: List<JSONObject>) {
        chatId = id; history = turns; applyBody = null; applied = false; error = null
        context = attachedContext(turns)
        originals = emptyMap()
        val last = turns.lastOrNull()
        result = last?.optJSONObject("proposal")?.takeIf { !last.optBoolean("applied") }
        turnId = result?.let { last?.text("id") }
        sources = last?.rows("sources").orEmpty()
        selected = assistantSelection(result)
        val dates = result?.rows("plans").orEmpty().mapNotNull { runCatching { LocalDate.parse(it.getJSONObject("fields").text("date")) }.getOrNull() }
        if (dates.isNotEmpty()) { start = dates.min(); end = dates.max() }
        proposalScope = json("start" to start.toString(), "end" to end.toString(), "timezone" to timezone,
            "start_minute" to (preferences?.optInt("start_minute", 480) ?: 480), "end_minute" to (preferences?.optInt("end_minute", 1320) ?: 1320))
        originals = result?.rows("rewrites").orEmpty().associate { change ->
            change.text("id") to currentAssistantMessage(repository, context, change.text("id")).text("content")
        }
    }
    LaunchedEffect(open) {
        if (open && !restoredChat && message == null && history.isEmpty()) {
            loadingChat = true
            try {
                val chats = JSONArray(repository.fetch("/ai/assistant/chats")).objects()
                chats.firstOrNull()?.text("id")?.let { id -> restoreConversation(id, JSONArray(repository.fetch("/ai/assistant/chats/$id")).objects()) }
                restoredChat = true
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { loadingChat = false }
        }
    }
    if (!open) return
    NotedSheet(onDismissRequest = close, title = "Ask Noted", sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.95f).imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (busy) NotedOutlinedButton({ job?.cancel() }) { Text("Stop response") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NotedOutlinedButton({ showChats = true }, enabled = !busy && !applying && !loadingChat) { Text("Conversations") }
                NotedTextButton({
                    chatId = null; turnId = null; history = emptyList(); result = null; sources = emptyList(); applyBody = null; applied = false
                    context = null; originals = emptyMap(); restoredChat = true; selectedPrompt = ""
                }, enabled = !busy && !applying && !loadingChat) { Text("New conversation") }
            }
            if (loadingChat) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (context == null) {
                DateField("From", start) { if (!busy && !applying && applyBody == null) start = it }
                DateField("Through", end) { if (!busy && !applying && applyBody == null) end = it }
            } else {
                message?.let { Markdown(it.text("content")) }
                Text("Message attached. Ask a question, request a rewrite, or ask for a thread reply.", style = MaterialTheme.typography.bodySmall)
                Choice("Saved prompt", selectedPrompt, listOf("" to "Custom instructions") + prompts.rows.filter { prompt ->
                    val places = prompt.optJSONArray("places")
                    places != null && (0 until places.length()).any { places.optString(it) == "messages" }
                }.map { it.text("id") to it.text("name") }) {
                    if (!busy && !applying && applyBody == null) {
                        selectedPrompt = it
                        instructions = prompts.rows.firstOrNull { prompt -> prompt.text("id") == it }?.text("instructions").orEmpty()
                    }
                }
            }
            history.takeLast(8).forEach { turn ->
                Text(if (turn.text("role") == "user") "You" else "Noted", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Markdown(turn.text("content"))
            }
            AiSources(repository, sources)
            if (busy) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(stage, style = MaterialTheme.typography.bodySmall) }
            error?.let { QuietNotice(it, true) }
            result?.let { proposal ->
                Markdown(proposal.text("explanation"))
                listOf("plans", "habits", "meals").forEach { group -> proposal.rows(group).forEachIndexed { index, change ->
                    val key = "$group-$index"
                    val fields = change.getJSONObject("fields")
                    Row(verticalAlignment = Alignment.Top) {
                        NotedCheckbox(key in selected, if (!busy && !applying && !applied && applyBody == null) { checked -> selected = if (checked) selected + key else selected - key } else null)
                        Column(Modifier.weight(1f).padding(vertical = 12.dp)) {
                            Text(fields.text("title", fields.text("name")), style = MaterialTheme.typography.titleSmall)
                            Text(if (change.text("id").isBlank()) "New ${group.dropLast(1)}" else "Edit existing ${group.dropLast(1)}", style = MaterialTheme.typography.labelSmall)
                            when (group) {
                                "plans" -> {
                                    Text("${fields.text("date")} · ${minuteLabel(fields.optInt("start_minute"))} - ${minuteLabel(fields.optInt("end_minute"))}")
                                    Text("${fields.text("frequency")} · ${fields.text("timezone")}", style = MaterialTheme.typography.bodySmall)
                                }
                                "habits" -> Text("${fields.optDouble("goal")} ${fields.text("unit")} · ${fields.text("period")}")
                                "meals" -> {
                                    Text("${fields.text("day")} · ${fields.text("slot")}")
                                    fields.rows("items").forEach { item -> Text("${item.text("name")}: ${item.optInt("kcal")} kcal", style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                        }
                    }
                } }
                AssistantWritingReview(proposal, originals, selected, !busy && !applying && !applied && applyBody == null,
                    { selected = it }, { clipboard.setText(AnnotatedString(it)) }) { posted ->
                    close(); navigate(channelRoute(posted.text("channel_id"), ChannelLocation(posted.text("message_id"), posted.text("thread_root_id"))))
                }
                if (applied) QuietNotice("Saved to your server.")
                else if (selected.isNotEmpty()) NotedButton(enabled = !busy && !applying && !loadingChat, modifier = Modifier.fillMaxWidth(), onClick = {
                    val body = applyBody ?: proposalScope!!.copy().put("explanation", proposal.text("explanation")).put("request_id", UUID.randomUUID().toString()).put("turn_id", turnId).apply {
                        listOf("plans", "habits", "meals").forEach { group -> put(group, JSONArray(proposal.rows(group).filterIndexed { index, _ -> "$group-$index" in selected })) }
                    }.also { applyBody = it }
                    applying = true; error = null
                    scope.launch {
                        try {
                            applyAssistantRewrites(repository, context, proposal.rows("rewrites").filterIndexed { index, _ -> "rewrites-$index" in selected }, originals)
                            repository.mutate("/ai/assistant/apply", body = body)
                            applied = true
                            applyBody = null
                        }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { error = failure.message; if (failure is ApiException && failure.status in 400..499) applyBody = null }
                        finally { applying = false }
                    }
                }) { Text(if (applying) "Saving…" else if (applyBody != null) "Retry saving" else "Apply selected changes") }
            }
            Field("What would you like to do?", instructions, { if (!busy && !applying && applyBody == null) { instructions = it.take(4000); selectedPrompt = "" } }, singleLine = false)
            PhotoPicker(repository, photos, enabled = !busy && !applying, busy = { uploading = it }) { photos = it }
            NotedButton(enabled = (instructions.isNotBlank() || photos.isNotEmpty()) && !busy && !applying && !uploading && !loadingChat && (applyBody == null || applied), modifier = Modifier.fillMaxWidth(), onClick = {
                busy = true; error = null; result = null; applied = false; applyBody = null; turnId = null
                val question = instructions.ifBlank { "Here are some pictures." }
                val request = json("start" to start.toString(), "end" to end.toString(), "timezone" to timezone,
                    "start_minute" to (preferences?.optInt("start_minute", 480) ?: 480), "end_minute" to (preferences?.optInt("end_minute", 1320) ?: 1320))
                proposalScope = request.copy()
                request.put("instructions", question).put("history", JSONArray(history.takeLast(18).map { turn ->
                    json("role" to turn.text("role"), "content" to (turn.optJSONObject("proposal")?.toString() ?: turn.text("content")))
                })).put("chat_id", chatId).put("photo_ids", JSONArray(photos))
                context?.let { attached -> request.put("context", attached.copy().apply { if (selectedPrompt.isNotBlank()) put("prompt_id", selectedPrompt) }) }
                job = scope.launch {
                    try {
                        repository.api.stream("/ai/assistant", request).collect { event ->
                            stage = event.text("heading", event.text("type"))
                            if (event.text("type") == "chat") chatId = event.text("chat_id")
                            if (event.text("type") == "turn") turnId = event.text("turn_id")
                            if (event.text("type") == "sources") sources = event.rows("sources")
                            if (event.text("type") == "error") error(event.text("message"))
                            if (event.text("type") == "done") {
                                result = event.getJSONObject("output")
                                sources = event.rows("sources").ifEmpty { sources }
                                selected = assistantSelection(result)
                                originals = result!!.rows("rewrites").associate { change -> change.text("id") to (originals[change.text("id")]
                                    ?: currentAssistantMessage(repository, context, change.text("id")).text("content")) }
                                repository.changed()
                                history = (history + json("role" to "user", "content" to question) + json("role" to "assistant", "content" to result!!.text("explanation"), "proposal" to result)).takeLast(18)
                                instructions = ""; photos = emptyList()
                            }
                        }
                        check(result != null) { "The answer was interrupted. Try again." }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { error = failure.message ?: "AI could not complete this request." }
                    finally { busy = false }
                }
            }) { Icon(NotedIcons.ArrowUpward, null); Text("Ask Noted", Modifier.padding(start = 8.dp)) }
            Text("Review changes before applying. AI can read your notes and journals using the server's existing tools.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (showChats) AssistantChats(repository, { showChats = false }) { id, turns ->
        scope.launch {
            loadingChat = true
            try { restoreConversation(id, turns); restoredChat = true }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { loadingChat = false }
        }
    }
}
