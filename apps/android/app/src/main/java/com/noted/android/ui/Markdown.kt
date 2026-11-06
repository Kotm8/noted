package com.noted.android.ui

import android.widget.TextView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin

private val taskLine = Regex("^(\\s*[-*+] \\[)([ xX])(] )(.*)$")

fun toggleTask(content: String, index: Int, checked: Boolean): String = content.lines().mapIndexed { line, text ->
    if (line != index) text else taskLine.matchEntire(text)?.let { "${it.groupValues[1]}${if (checked) "x" else " "}${it.groupValues[3]}${it.groupValues[4]}" } ?: text
}.joinToString("\n")

fun continueTask(before: String, after: String): String {
    if (after.length != before.length + 1) return after
    val position = after.indices.firstOrNull { it >= before.length || after[it] != before[it] } ?: return after
    if (after[position] != '\n') return after
    val lineStart = after.lastIndexOf('\n', (position - 1).coerceAtLeast(0)) + 1
    val previous = after.substring(lineStart, position)
    val match = taskLine.matchEntire(previous) ?: return after
    if (match.groupValues[4].isBlank()) return after.removeRange(lineStart, position)
    return after.substring(0, position + 1) + match.groupValues[1] + " " + match.groupValues[3] + after.substring(position + 1)
}

@Composable
fun Markdown(content: String, change: ((String) -> Unit)? = null, modifier: Modifier = Modifier, activate: (() -> Unit)? = null) {
    val lines = content.lines()
    Column(modifier) {
        var start = 0
        lines.forEachIndexed { index, line ->
            val match = taskLine.matchEntire(line)
            if (match != null) {
                if (index > start) MarkdownText(lines.subList(start, index).joinToString("\n"), activate)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    NotedCheckbox(match.groupValues[2] != " ", onCheckedChange = change?.let { save -> { checked -> save(toggleTask(content, index, checked)) } })
                    Box(Modifier.weight(1f)) { MarkdownText(match.groupValues[4], activate) }
                }
                start = index + 1
            }
        }
        if (start < lines.size) MarkdownText(lines.subList(start, lines.size).joinToString("\n"), activate)
    }
}

@Composable
fun MarkdownText(text: String, activate: (() -> Unit)? = null) {
    val context = LocalContext.current
    val markwon = remember(context) { Markwon.builder(context).usePlugin(StrikethroughPlugin.create()).build() }
    val foreground = MaterialTheme.colorScheme.onSurface.toArgb()
    val link = NotedStyle.colors.link.toArgb()
    val density = LocalDensity.current
    val textPixels = with(density) { MaterialTheme.typography.bodyLarge.fontSize.toPx() }
    AndroidView(factory = { TextView(it).apply {
        setTextIsSelectable(true)
        setPadding(0, 0, 0, 0)
        setLineSpacing(4f, 1.1f)
    } }, modifier = Modifier.fillMaxWidth(), update = {
        it.setTextIsSelectable(activate == null)
        it.setTextColor(foreground); it.setLinkTextColor(link)
        it.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, textPixels)
        it.setOnClickListener(if (activate != null) android.view.View.OnClickListener { activate() } else null)
        if (it.tag != text) { markwon.setMarkdown(it, text); it.tag = text }
    })
}
