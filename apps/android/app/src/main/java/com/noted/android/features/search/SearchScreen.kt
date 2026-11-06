package com.noted.android.features.search

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.data.*
import com.noted.android.features.home.channelIcon
import com.noted.android.ui.*
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private const val PAGE = 30

/**
 * Search across messages, journals and documents (phone home story 2). The field is the header and
 * is focused on open; kind chips sit under it, and each result is a meta line over the excerpt with
 * the match picked out. Further pages are appended with Show more.
 */
@Composable
fun SearchScreen(repository: NativeRepository, library: Boolean, channels: List<JSONObject>, open: (String) -> Unit, close: (() -> Unit)? = null) {
    if (library) { LibraryScreen(repository, channels, open); return }
    val colors = NotedStyle.colors
    var query by rememberSaveable { mutableStateOf("") }
    var debounced by remember { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("") }
    var offset by remember { mutableIntStateOf(0) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query) { delay(250); debounced = query.trim() }
    var results by remember(debounced, kind) { mutableStateOf(emptyList<JSONObject>()) }
    LaunchedEffect(debounced, kind) { offset = 0 }
    val resource = rememberResource(repository, if (debounced.length >= 2)
        "/search?q=${Uri.encode(debounced)}&offset=$offset&limit=$PAGE${if (kind.isNotBlank()) "&kind=$kind" else ""}" else null)
    val page = resource.obj?.takeIf { it.optInt("offset") == offset }?.rows("items")
    LaunchedEffect(page) {
        if (page != null) results = (if (offset == 0) page else results + page).distinctBy { it.text("id") }
    }
    val total = resource.obj?.optInt("total") ?: 0

    Column(Modifier.fillMaxSize().background(colors.main)) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (close != null) IconButton(close) { Icon(NotedIcons.ArrowBack, "Close search", tint = colors.secondary) }
            Box(Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(22.dp)).background(colors.input).padding(horizontal = 16.dp),
                contentAlignment = Alignment.CenterStart) {
                if (query.isEmpty()) Text("Search", color = colors.faint)
                BasicTextField(query, { query = it.take(200) }, Modifier.fillMaxWidth().focusRequester(focus), singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.text), cursorBrush = SolidColor(colors.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
            }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("" to "All", "message" to "Messages", "journal" to "Journals", "document" to "Notes").forEach { (value, label) ->
                PillChip(label, kind == value, { kind = value })
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 24.dp)) {
            when {
                debounced.length < 2 -> Unit
                resource.error != null && results.isEmpty() -> item { SearchNote(resource.error ?: "Search didn't load. Try again.") }
                page != null && results.isEmpty() -> item { SearchNote("Nothing matches \"$debounced\".") }
                else -> {
                    items(results, key = { it.text("id") }) { result -> SearchRow(result, debounced) { open(searchRoute(result)) } }
                    if (total > results.size && results.isNotEmpty()) item {
                        NotedTextButton({ offset = results.size }, Modifier.fillMaxWidth().padding(top = 8.dp), enabled = !resource.refreshing) {
                            Text(if (resource.refreshing) "Loading…" else "Show more")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchNote(text: String) = Text(text, Modifier.padding(vertical = 16.dp), color = NotedStyle.colors.muted, fontSize = 14.sp)

@Composable
private fun SearchRow(result: JSONObject, query: String, open: () -> Unit) {
    val colors = NotedStyle.colors
    val where = when (result.text("kind")) { "journal", "document" -> result.text("channel_name"); else -> "# ${result.text("channel_name")}" }
    Column(Modifier.fillMaxWidth().clickable(onClick = open).padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(listOf(where, resultDate(result.text("created_at"))).filter { it.isNotBlank() }.joinToString(" · "),
            color = colors.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(highlight(readableExcerpt(result.text("excerpt")), query, colors.accent), color = colors.text, maxLines = 2,
            overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
    }
    HorizontalDivider(color = colors.subtle)
}

/** Excerpts are cut from the stored Markdown, so headings, task boxes and emphasis marks are dropped for display. */
internal fun readableExcerpt(text: String): String = text
    .replace(Regex("""\[([^\]]*)]\([^)]*\)"""), "$1")
    .replace(Regex("""(^|\s)#{1,6}\s+"""), "$1")
    .replace(Regex("""(^|\s)[-*+]\s+\[[ xX]]\s+"""), "$1")
    .replace(Regex("""(^|\s)[-*+]\s+\[[ xX]](?=\s|$)"""), "$1")
    .replace(Regex("""(^|\s)>\s+"""), "$1")
    .replace(Regex("""(\*\*|__|`|~~)"""), "")
    .replace(Regex("""\s{2,}"""), " ")
    .trim()

private fun highlight(text: String, query: String, accent: Color) = buildAnnotatedString {
    val terms = query.split(Regex("""\s+""")).filter { it.length >= 2 }.map { Regex.escape(it) }
    if (terms.isEmpty()) { append(text); return@buildAnnotatedString }
    var last = 0
    Regex(terms.joinToString("|"), RegexOption.IGNORE_CASE).findAll(text).forEach { match ->
        append(text.substring(last, match.range.first))
        withStyle(SpanStyle(color = accent, fontWeight = FontWeight.SemiBold)) { append(match.value) }
        last = match.range.last + 1
    }
    append(text.substring(last))
}

private fun resultDate(iso: String): String = runCatching {
    val zone = ZoneId.systemDefault()
    val at = OffsetDateTime.parse(iso).atZoneSameInstant(zone)
    val today = LocalDate.now(zone)
    when {
        at.toLocalDate() == today -> "Today"
        at.toLocalDate() == today.minusDays(1) -> "Yesterday"
        at.year == today.year -> at.format(DateTimeFormatter.ofPattern("d MMM"))
        else -> at.format(DateTimeFormatter.ofPattern("d MMM yyyy"))
    }
}.getOrDefault("")
