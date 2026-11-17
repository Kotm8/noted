package com.noted.android.ui

import android.graphics.Paint
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
fun Markdown(content: String, change: ((String) -> Unit)? = null, modifier: Modifier = Modifier, activate: (() -> Unit)? = null,
    completed: Boolean = false, completedReminders: Set<String> = emptySet()) {
    val lines = content.lines()
    val readingWidth = (LocalAppearancePreferences.current?.optInt("readingWidth", 960) ?: 960).dp
    Column(modifier.widthIn(max = readingWidth)) {
        var start = 0
        lines.forEachIndexed { index, line ->
            val match = taskLine.matchEntire(line)
            if (match != null) {
                if (index > start) MarkdownText(lines.subList(start, index).joinToString("\n"), activate, completed, completedReminders)
                val checked = match.groupValues[2] != " "
                Row(verticalAlignment = Alignment.CenterVertically) {
                    NotedCheckbox(checked, onCheckedChange = change?.let { save -> { checked -> save(toggleTask(content, index, checked)) } })
                    Box(Modifier.weight(1f)) { MarkdownText(match.groupValues[4], activate, completed || checked, completedReminders) }
                }
                start = index + 1
            }
        }
        if (start < lines.size) MarkdownText(lines.subList(start, lines.size).joinToString("\n"), activate, completed, completedReminders)
    }
}

@Composable
fun MarkdownText(text: String, activate: (() -> Unit)? = null, completed: Boolean = false, completedReminders: Set<String> = emptySet()) {
    val context = LocalContext.current
    val preferences = LocalAppearancePreferences.current
    val family = when (preferences?.optString("font")) { "serif" -> android.graphics.Typeface.SERIF; "mono" -> android.graphics.Typeface.MONOSPACE; else -> android.graphics.Typeface.SANS_SERIF }
    val codeFamily = if (preferences?.optString("codeFont") == "courier") android.graphics.Typeface.create("courier", android.graphics.Typeface.NORMAL) else android.graphics.Typeface.MONOSPACE
    val lineHeight = (preferences?.optDouble("lineHeight", 1.6) ?: 1.6).toFloat()
    val markwon = remember(context, codeFamily) { Markwon.builder(context).usePlugin(StrikethroughPlugin.create()).usePlugin(object : io.noties.markwon.AbstractMarkwonPlugin() {
        override fun configureTheme(builder: io.noties.markwon.core.MarkwonTheme.Builder) { builder.codeTypeface(codeFamily) }
    }).build() }
    val foreground = (if (completed) NotedStyle.colors.muted else MaterialTheme.colorScheme.onSurface).toArgb()
    val rendered = if (completedReminders.isEmpty()) text else text.replace(
        Regex("""\[(?:\\.|[^\]\\])*\]\(#reminder-([a-fA-F0-9-]{36})\)"""),
    ) { if (it.groupValues[1] in completedReminders) "~~${it.value}~~" else it.value }
    val link = NotedStyle.colors.link.toArgb()
    val density = LocalDensity.current
    val textPixels = with(density) { MaterialTheme.typography.bodyLarge.fontSize.toPx() }
    AndroidView(factory = { TextView(it).apply {
        setTextIsSelectable(true)
        setPadding(0, 0, 0, 0)
        setLineSpacing(4f, 1.1f)
    } }, modifier = Modifier.fillMaxWidth(), update = {
        it.setTextIsSelectable(activate == null)
        it.typeface = family
        it.setLineSpacing(0f, lineHeight)
        it.setTextColor(foreground); it.setLinkTextColor(link)
        it.paintFlags = if (completed) it.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG else it.paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
        it.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, textPixels)
        it.setOnClickListener(if (activate != null) android.view.View.OnClickListener { activate() } else null)
        if (it.tag != rendered) { markwon.setMarkdown(it, rendered); it.tag = rendered }
    })
}
