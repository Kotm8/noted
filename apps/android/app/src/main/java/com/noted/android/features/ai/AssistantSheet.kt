package com.noted.android.features.ai

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.data.*
import com.noted.android.features.media.NativeImage
import com.noted.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

/** Opens the assistant from anywhere below NotedApp, optionally about one message. */
val LocalAskAi = staticCompositionLocalOf<(JSONObject?) -> Unit> { {} }

/** True while the assistant panel is open, so screens can hide their own text box under it. */
val LocalAssistantOpen = compositionLocalOf { false }

/**
 * The assistant as a panel that starts at half height inside the screen's content area, so the
 * screen above stays visible and usable (phone home story 3). It is laid out in place rather than
 * as a modal sheet because a modal's scrim would block the screen behind it. Dragging the header
 * moves it between half height, full height and closed; typing raises it to full height so the
 * keyboard never squeezes the conversation. Nothing the assistant proposes is saved until Apply.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BoxScope.AssistantPanel(repository: NativeRepository, open: Boolean, message: JSONObject?, available: Dp, close: () -> Unit) {
    val colors = NotedStyle.colors
    val density = LocalDensity.current
    val halfPx = with(density) { (available * .5f).toPx() }
    val fullPx = with(density) { (available - 12.dp).toPx() }
    val height = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    LaunchedEffect(open) { if (!open) focus.clearFocus(force = true) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(open, message?.text("id")) { if (open) expanded = false }
    val typing = WindowInsets.isImeVisible
    LaunchedEffect(open, expanded, typing, halfPx, fullPx) {
        height.animateTo(if (!open) 0f else if (expanded || typing) fullPx else halfPx)
    }
    val drag = rememberDraggableState { delta -> scope.launch { height.snapTo((height.value - delta).coerceIn(0f, fullPx)) } }
    fun settle(velocity: Float) {
        val value = height.value
        val target = when {
            velocity > 1800 -> if (value > halfPx * 1.1f) halfPx else 0f
            velocity < -1800 -> fullPx
            value < halfPx * .6f -> 0f
            value < (halfPx + fullPx) / 2 -> halfPx
            else -> fullPx
        }
        if (target == 0f) close() else { expanded = target == fullPx; scope.launch { height.animateTo(target) } }
    }
    Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(with(density) { height.value.toDp() })
        .shadow(16.dp, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
        .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp)).background(colors.floating)
        .border(1.dp, colors.border, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
        .semantics { paneTitle = "Ask Noted" }) {
        AssistantConversation(repository, open, message, expanded || typing, Modifier.draggable(drag, Orientation.Vertical, onDragStopped = { settle(it) }),
            { expanded = !expanded }, close)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AssistantConversation(repository: NativeRepository, open: Boolean, message: JSONObject?, expanded: Boolean, dragHandle: Modifier,
    toggleSize: () -> Unit, close: () -> Unit) {
    val colors = NotedStyle.colors
    var instructions by rememberSaveable { mutableStateOf("") }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var history by remember { mutableStateOf(emptyList<JSONObject>()) }
    var chatId by rememberSaveable { mutableStateOf<String?>(null) }
    var turnId by remember { mutableStateOf<String?>(null) }
    var sources by remember { mutableStateOf(emptyList<JSONObject>()) }
    var showChats by remember { mutableStateOf(false) }
    var photos by remember { mutableStateOf(emptyList<String>()) }
    var uploading by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var actionResults by remember { mutableStateOf(emptyList<JSONObject>()) }
    var regularSaved by remember { mutableStateOf(false) }
    var confirmActions by remember { mutableStateOf(false) }
    var stage by remember { mutableStateOf("") }
    var streaming by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var busy by remember { mutableStateOf(false) }
    var applied by remember { mutableStateOf(false) }
    var applyBody by remember { mutableStateOf<JSONObject?>(null) }
    var applying by remember { mutableStateOf(false) }
    var loadingChat by remember { mutableStateOf(false) }
    var restoredChat by remember { mutableStateOf(false) }
    var context by remember { mutableStateOf<JSONObject?>(null) }
    var attachedText by remember { mutableStateOf("") }
    var originals by remember { mutableStateOf(emptyMap<String, String>()) }
    var selectedPrompt by remember { mutableStateOf("") }
    var choosingRange by remember { mutableStateOf(false) }
    val prompts = rememberResource(repository, if (open && context != null) "/ai/prompts" else null)
    val clipboard = LocalClipboardManager.current
    val navigate = LocalNotedNavigate.current
    val androidContext = LocalContext.current
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()
    val tracker = rememberResource(repository, if (open) "/time-tracking/tracker" else null)
    val preferences = tracker.obj?.optJSONObject("preferences")
    val timezone = preferences?.text("timezone")?.takeIf { it.isNotBlank() } ?: ZoneId.systemDefault().id
    var start by remember { mutableStateOf(LocalDate.now(ZoneId.of(timezone))) }
    var end by remember { mutableStateOf(start.plusDays(6)) }
    var proposalScope by remember { mutableStateOf<JSONObject?>(null) }
    var following by remember { mutableStateOf(true) }
    val account = repository.session.collectAsState().value?.partition
    var draftLoaded by remember(account) { mutableStateOf(false) }
    LaunchedEffect(account) {
        account?.let {
            val saved = runCatching { JSONObject(repository.drafts.read(it, "assistant")) }.getOrNull()
            if (saved != null) {
                instructions = saved.text("instructions"); chatId = saved.text("chat_id").takeIf(String::isNotBlank)
                turnId = saved.text("turn_id").takeIf(String::isNotBlank); history = saved.rows("history")
                result = saved.optJSONObject("proposal"); selected = saved.optJSONArray("selected")?.let { array -> (0 until array.length()).map { array.getString(it) }.toSet() }.orEmpty()
                proposalScope = saved.optJSONObject("scope"); applyBody = saved.optJSONObject("apply_body"); applied = saved.optBoolean("applied")
                context = saved.optJSONObject("context"); sources = saved.rows("sources"); actionResults = saved.rows("action_results"); regularSaved = saved.optBoolean("regular_saved")
                saved.optJSONObject("originals")?.let { values -> originals = values.keys().asSequence().associateWith { values.getString(it) } }
                saved.optJSONArray("photos")?.let { values -> photos = (0 until values.length()).map { values.getString(it) } }
                restoredChat = history.isNotEmpty()
            }
        }
        draftLoaded = true
    }
    LaunchedEffect(instructions, history, result, selected, proposalScope, applyBody, applied, chatId, turnId, draftLoaded, context, originals, photos, actionResults, regularSaved) {
        if (draftLoaded && account != null) repository.drafts.write(account, "assistant", json(
            "instructions" to instructions, "chat_id" to chatId, "turn_id" to turnId, "history" to JSONArray(history),
            "proposal" to result, "selected" to JSONArray(selected.toList()), "scope" to proposalScope,
            "apply_body" to applyBody, "applied" to applied, "context" to context, "originals" to JSONObject(originals),
            "sources" to JSONArray(sources), "photos" to JSONArray(photos), "action_results" to JSONArray(actionResults), "regular_saved" to regularSaved).toString())
    }
    val locked = busy || applying || loadingChat

    fun reset() {
        job?.cancel()
        actionResults = emptyList(); regularSaved = false
        chatId = null; turnId = null; history = emptyList(); result = null; sources = emptyList(); applyBody = null; applied = false
        context = null; attachedText = ""; originals = emptyMap(); restoredChat = true; selectedPrompt = ""; streaming = ""; pending = null; error = null
    }
    suspend fun restoreConversation(id: String, turns: List<JSONObject>) {
        actionResults = emptyList(); regularSaved = false
        chatId = id; history = turns; applyBody = null; applied = false; error = null; streaming = ""; pending = null
        context = attachedContext(turns); attachedText = ""
        originals = emptyMap()
        val last = turns.lastOrNull()
        result = last?.optJSONObject("proposal")?.takeIf { !last.optBoolean("applied") }
        turnId = result?.let { last?.text("id") }
        sources = last?.rows("sources").orEmpty()
        selected = assistantSelection(result)
        val dates = result?.rows("plans").orEmpty().mapNotNull { runCatching { LocalDate.parse(it.getJSONObject("fields").text("date")) }.getOrNull() }
        if (dates.isNotEmpty()) { start = dates.min(); end = dates.max() }
        // Worked out at Apply instead, once the owner's timezone and hours have loaded.
        proposalScope = null
        originals = result?.rows("rewrites").orEmpty().associate { change ->
            change.text("id") to currentAssistantMessage(repository, context, change.text("id")).text("content")
        }
    }
    LaunchedEffect(open, message?.text("id"), draftLoaded) {
        if (!open || !draftLoaded) return@LaunchedEffect
        if (message != null) {
            reset()
            context = json("channel_id" to message.text("channel_id"), "message_ids" to JSONArray(listOf(message.text("id"))),
                "thread_root_id" to message.opt("thread_root_id"))
            attachedText = message.text("content")
            originals = mapOf(message.text("id") to message.text("content"))
        } else if (!restoredChat && history.isEmpty()) {
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
    LaunchedEffect(scroll) {
        snapshotFlow { scroll.value to scroll.maxValue }.collect { (position, maximum) ->
            if (scroll.isScrollInProgress) following = maximum - position < 64
        }
    }
    LaunchedEffect(history.size, streaming.length, result, error, busy, expanded) { if (following) scroll.scrollTo(scroll.maxValue) }

    fun ask(question: String) {
        actionResults = emptyList(); regularSaved = false
        busy = true; error = null; result = null; applied = false; applyBody = null; turnId = null; streaming = ""; stage = "Thinking…"; pending = question
        val request = json("start" to start.toString(), "end" to end.toString(), "timezone" to timezone,
            "start_minute" to (preferences?.optInt("start_minute", 480) ?: 480), "end_minute" to (preferences?.optInt("end_minute", 1320) ?: 1320))
        proposalScope = request.copy()
        request.put("instructions", question).put("history", JSONArray(history.takeLast(18).map { turn ->
            json("role" to turn.text("role"), "content" to (turn.optJSONObject("proposal")?.toString() ?: turn.text("content")))
        })).put("chat_id", chatId).put("photo_ids", JSONArray(photos))
        context?.let { attached -> request.put("context", attached.copy().apply { if (selectedPrompt.isNotBlank()) put("prompt_id", selectedPrompt) }) }
        instructions = ""
        job = scope.launch {
            try {
                repository.api.stream("/ai/assistant", request).collect { event ->
                    when (event.text("type")) {
                        "chat" -> chatId = event.text("chat_id")
                        "turn" -> turnId = event.text("turn_id")
                        "thinking" -> stage = event.text("heading").ifBlank { "Thinking…" }
                        "search" -> stage = if (event.text("action") == "read") "Reading notes…" else "Searching…"
                        "sources" -> sources = event.rows("sources")
                        "explanation" -> { streaming = event.text("text"); stage = "" }
                        "error" -> error(event.text("message"))
                        "done" -> {
                            result = event.getJSONObject("output")
                            sources = event.rows("sources").ifEmpty { sources }
                            selected = assistantSelection(result)
                            originals = result!!.rows("rewrites").associate { change -> change.text("id") to (originals[change.text("id")]
                                ?: currentAssistantMessage(repository, context, change.text("id")).text("content")) }
                            repository.changed()
                            history = (history + json("role" to "user", "content" to question) +
                                json("role" to "assistant", "content" to result!!.text("explanation"), "proposal" to result)).takeLast(18)
                            photos = emptyList(); streaming = ""; pending = null
                        }
                    }
                }
                check(result != null) { "The answer was interrupted. Try again." }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "AI could not complete this request."; if (instructions.isBlank()) instructions = question; pending = null }
            finally { busy = false }
        }
    }
    fun applyProposal(proposal: JSONObject, confirmed: Boolean) {
        val posts = proposal.rows("posts").mapIndexedNotNull { index, item -> if ("posts-$index" in selected) item.copy().put("key", "post-$index") else null }
        val deletions = proposal.rows("deletions").mapIndexedNotNull { index, item -> if ("deletions-$index" in selected) item.copy().put("key", "delete-$index") else null }
        val limits = proposalScope ?: json("start" to start.toString(), "end" to end.toString(), "timezone" to timezone,
            "start_minute" to (preferences?.optInt("start_minute", 480) ?: 480), "end_minute" to (preferences?.optInt("end_minute", 1320) ?: 1320))
        val body = applyBody ?: limits.copy().put("explanation", proposal.text("explanation")).put("request_id", UUID.randomUUID().toString())
            .put("turn_id", if (posts.isEmpty() && deletions.isEmpty()) turnId else JSONObject.NULL).apply {
                listOf("plans", "habits", "meals").forEach { group -> put(group, JSONArray(proposal.rows(group).filterIndexed { index, _ -> "$group-$index" in selected })) }
            }.also { applyBody = it }
        applying = true; error = null
        scope.launch {
            try {
                if (!regularSaved) {
                    applyAssistantRewrites(repository, context, proposal.rows("rewrites").filterIndexed { index, _ -> "rewrites-$index" in selected }, originals)
                    if (listOf("plans", "habits", "meals").any { body.rows(it).isNotEmpty() } || (posts.isEmpty() && deletions.isEmpty())) repository.mutate("/ai/assistant/apply", body = body)
                    regularSaved = true
                }
                if (posts.isNotEmpty() || deletions.isNotEmpty()) {
                    val response = JSONObject(repository.mutate("/ai/assistant/apply-actions", body = json("request_id" to body.text("request_id"), "turn_id" to turnId,
                        "posts" to JSONArray(posts), "deletions" to JSONArray(deletions), "confirmed" to confirmed)))
                    actionResults = response.rows("results")
                    check(actionResults.all { it.optBoolean("ok") }) { "${actionResults.count { it.optBoolean("ok") }} actions completed. Review the failed actions." }
                }
                applied = true
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { repository.changed(); applying = false }
        }
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            uploading = true
            try {
                for (uri in uris.take(4 - photos.size)) {
                    photos = photos + JSONObject(repository.api.uploadFile(androidContext, "/nutrition/photos", uri, maxBytes = 25L * 1024 * 1024)).text("id")
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message }
            finally { uploading = false }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Column(dragHandle.fillMaxWidth().padding(top = 8.dp)) {
            Box(Modifier.align(Alignment.CenterHorizontally).size(36.dp, 4.dp).background(colors.border, CircleShape))
            Row(Modifier.fillMaxWidth().height(48.dp).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Assistant", Modifier.weight(1f), color = colors.text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                ActionIcon(NotedIcons.Schedule, "Earlier chats", enabled = !locked) { showChats = true }
                ActionIcon(NotedIcons.Add, "New chat", enabled = !locked) { reset() }
                ActionIcon(if (expanded) NotedIcons.ChevronDown else NotedIcons.ChevronUp, if (expanded) "Half height" else "Full height", action = toggleSize)
                ActionIcon(NotedIcons.Close, "Close", action = close)
            }
            HorizontalDivider(color = colors.subtle)
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (loadingChat) LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.accent)
            if (context != null) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.main).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("About this note", color = colors.muted, fontSize = 13.sp)
                    if (attachedText.isNotBlank()) Text(attachedText, color = colors.text, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    val messagePrompts = prompts.rows.filter { prompt ->
                        val places = prompt.optJSONArray("places")
                        places != null && (0 until places.length()).any { places.optString(it) == "messages" }
                    }
                    if (messagePrompts.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        messagePrompts.forEach { prompt ->
                            NotedFilterChip(selectedPrompt == prompt.text("id"), {
                                if (!locked && applyBody == null) {
                                    selectedPrompt = if (selectedPrompt == prompt.text("id")) "" else prompt.text("id")
                                    instructions = if (selectedPrompt.isBlank()) "" else prompt.text("instructions")
                                }
                            }, { Text(prompt.text("name")) })
                        }
                    }
                }
            }
            if (history.isEmpty() && pending == null && !loadingChat && context == null) {
                Text("Ask about your day, plan your time, log a meal or find something in your notes.", color = colors.muted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("What's left today?", "Plan tomorrow", "What did I eat today?").forEach { suggestion ->
                        NotedFilterChip(false, { if (!locked) ask(suggestion) }, { Text(suggestion) })
                    }
                }
            }
            history.takeLast(12).forEach { turn ->
                if (turn.text("role") == "user") UserBubble(turn.text("content")) else {
                    Markdown(turn.text("content"))
                    turn.optJSONObject("proposal")?.rows("action_results")?.filter { it.optBoolean("ok") && it.text("url").isNotBlank() }?.forEach { item ->
                        NotedTextButton({ notedRoute(android.net.Uri.parse(repository.api.origin + item.text("url")))?.let(navigate) }) { Text("Open posted message") }
                    }
                }
            }
            pending?.let { UserBubble(it) }
            if (streaming.isNotBlank()) Markdown(streaming)
            if (busy && stage.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), color = colors.accent, strokeWidth = 2.dp)
                Text(stage, color = colors.muted, fontSize = 14.sp)
            }
            AiSources(repository, sources)
            result?.let { proposal ->
                listOf("plans", "habits", "meals").forEach { group -> proposal.rows(group).forEachIndexed { index, change ->
                    val key = "$group-$index"
                    ChangeCard(group, change, key in selected, !locked && !applied && applyBody == null) { checked ->
                        selected = if (checked) selected + key else selected - key
                    }
                } }
                AssistantWritingReview(proposal, originals, selected, !locked && !applied && applyBody == null,
                    { selected = it }, { clipboard.setText(AnnotatedString(it)) }) { posted ->
                    close(); navigate(channelRoute(posted.text("channel_id"), ChannelLocation(posted.text("message_id"), posted.text("thread_root_id"))))
                }
                AssistantActions(proposal, selected, !locked && !applied && applyBody == null, { selected = it }, { result = it })
                if (applied) QuietNotice("Saved to your server.")
                else if (selected.isNotEmpty()) PillButton(enabled = !locked && proposal.rows("deletions").withIndex().none { (index, item) ->
                    "deletions-$index" in selected && item.text("kind") == "plan" && item.optJSONObject("target")?.text("frequency") != "none" && item.text("scope").isBlank()
                }, modifier = Modifier.fillMaxWidth(), primary = true, onClick = {
                    if (proposal.rows("deletions").indices.any { "deletions-$it" in selected }) confirmActions = true else applyProposal(proposal, false)
                }) { Text(if (applying) "Saving..." else if (applyBody != null) "Retry saving" else "Apply ${selected.size} changes") }
                actionResults.forEach { item ->
                    if (item.optBoolean("ok")) {
                        Text(if (item.text("key").startsWith("post-")) "Posted" else "Deleted", color = colors.success)
                        item.text("url").takeIf { it.isNotBlank() }?.let { url -> NotedTextButton({ notedRoute(android.net.Uri.parse(repository.api.origin + url))?.let(navigate) }) { Text("Open message") } }
                    } else QuietNotice("${item.text("key")}: ${item.text("error")}", true)
                }
            }
            error?.let { QuietNotice(it, true) }
        }
        HorizontalDivider(color = colors.subtle)
        Column(Modifier.fillMaxWidth().background(colors.rail).padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 8.dp)) {
            if (!following) PillButton({ following = true; scope.launch { scroll.scrollTo(scroll.maxValue) } }, Modifier.align(Alignment.CenterHorizontally)) { Text("Latest messages") }
            if (context == null) Text("Plans: ${rangeLabel(start, end)}", Modifier.padding(start = 8.dp, bottom = 6.dp).clip(RoundedCornerShape(6.dp))
                .clickable(enabled = !locked && applyBody == null, onClickLabel = "Change the planning dates") { choosingRange = true }
                .padding(horizontal = 4.dp, vertical = 2.dp), color = colors.muted, fontSize = 13.sp)
            if (photos.isNotEmpty() || uploading) LazyRow(Modifier.padding(start = 8.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(photos, key = { it }) { id ->
                    Box(Modifier.size(56.dp).clip(RoundedCornerShape(8.dp))) {
                        NativeImage(repository, "/api/v1/nutrition/photos/$id", "Attached picture", Modifier.fillMaxSize())
                        Box(Modifier.align(Alignment.TopEnd).size(22.dp).background(colors.main.copy(alpha = .75f), CircleShape)
                            .clickable(onClickLabel = "Remove picture") { photos = photos - id }, contentAlignment = Alignment.Center) {
                            Icon(NotedIcons.Close, null, Modifier.size(12.dp), tint = colors.text)
                        }
                    }
                }
                if (uploading) item { Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp), color = colors.accent, strokeWidth = 2.dp) } }
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(colors.input).border(1.dp, colors.border, RoundedCornerShape(24.dp))
                .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                NotedTextField(instructions, { if (!locked && applyBody == null) { instructions = it.take(4000); selectedPrompt = "" } }, Modifier.weight(1f),
                    placeholder = { Text(if (context != null) "Ask about this note…" else "Ask anything…") }, maxLines = 5, chrome = false)
                ActionIcon(NotedIcons.Image, "Attach pictures", enabled = !locked && !uploading && photos.size < 4) {
                    gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
                if (busy) NotedFilledIconButton({ job?.cancel() }, Modifier.size(44.dp)) { Icon(NotedIcons.Stop, "Stop response", Modifier.size(18.dp)) }
                else NotedFilledIconButton({ ask(instructions.trim().ifBlank { "Here are some pictures." }) }, Modifier.size(44.dp),
                    enabled = (instructions.isNotBlank() || photos.isNotEmpty()) && !locked && !uploading && (applyBody == null || applied)) {
                    Icon(NotedIcons.ArrowUpward, "Send", Modifier.size(20.dp))
                }
            }
        }
    }
    if (confirmActions) DesignSheet({ confirmActions = false }, "Confirm deletions") {
        result?.rows("deletions")?.forEachIndexed { index, item -> if ("deletions-$index" in selected) {
            Text("${item.optJSONObject("target")?.text("title").orEmpty()} (${if (item.text("scope") == "occurrence") item.text("occurrence_date") else if (item.text("kind") == "plan") "entire series" else item.text("kind")})", Modifier.padding(vertical = 8.dp))
        } }
        PillButton({ confirmActions = false; result?.let { applyProposal(it, true) } }, primary = true) { Text("Confirm and apply") }
    }
    if (choosingRange) NotedSheet({ choosingRange = false }, title = "Dates for plans") {
        Column(Modifier.padding(16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Plans the assistant proposes stay inside these dates.", color = colors.muted, fontSize = 14.sp)
            DateField("From", start) { start = it; if (end < it) end = it }
            DateField("Through", end) { end = if (it < start) start else it }
            NotedButton({ choosingRange = false }, Modifier.fillMaxWidth()) { Text("Done") }
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

private fun rangeLabel(start: LocalDate, end: LocalDate): String {
    val day = DateTimeFormatter.ofPattern("d MMM")
    return if (start == end) start.format(day) else "${start.format(day)} – ${end.format(day)}"
}

@Composable
private fun UserBubble(text: String) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(text, Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp)).background(NotedStyle.colors.selected)
            .padding(horizontal = 12.dp, vertical = 8.dp), color = NotedStyle.colors.text)
    }
}

@Composable
private fun ChangeCard(group: String, change: JSONObject, checked: Boolean, enabled: Boolean, toggle: (Boolean) -> Unit) {
    val colors = NotedStyle.colors
    val fields = change.getJSONObject("fields")
    val kind = group.dropLast(1)
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.main)
        .border(1.dp, if (checked) colors.border else colors.subtle, RoundedCornerShape(12.dp))
        .clickable(enabled = enabled, role = Role.Checkbox) { toggle(!checked) }.padding(12.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        NotedCheckbox(checked, if (enabled) toggle else null)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (change.text("id").isBlank()) "New $kind" else "Change $kind", color = colors.muted, fontSize = 12.sp)
            Text(fields.text("title", fields.text("name")), color = colors.text, fontWeight = FontWeight.Medium)
            val detail = when (group) {
                "plans" -> "${fields.text("date")} · ${minuteLabel(fields.optInt("start_minute"))}–${minuteLabel(fields.optInt("end_minute"))}"
                "habits" -> "${fields.optDouble("goal").let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }} ${fields.text("unit")} · ${fields.text("period")}"
                else -> "${fields.text("day")} · ${fields.text("slot")} · ${fields.rows("items").sumOf { it.optInt("kcal") }} kcal"
            }
            Text(detail, color = colors.secondary, fontSize = 14.sp)
            if (group == "meals") fields.rows("items").forEach { item ->
                Text("${item.text("name")} · ${item.optInt("kcal")} kcal", color = colors.muted, fontSize = 13.sp)
            }
        }
    }
}
