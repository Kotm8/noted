package com.noted.android.features.channels

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import com.noted.android.ui.NotedStyle

@Composable
fun MessagePresentation(layout: String, time: String?, burst: Boolean, minuteMarker: Boolean, content: @Composable () -> Unit) {
    val colors = NotedStyle.colors
    when (layout) {
        "quiet" -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Box(Modifier.width(44.dp).padding(top = 6.dp)) { if (burst) Timestamp(time) }
            Box(Modifier.weight(1f)) { content() }
        }
        "connected" -> Column(Modifier.fillMaxWidth().drawBehind {
                val x = 4.dp.toPx()
                drawLine(colors.border, Offset(x, 0f), Offset(x, size.height), 1.dp.toPx())
                if (burst) drawCircle(colors.muted, 2.dp.toPx(), Offset(x, 12.dp.toPx()))
            }.padding(start = 16.dp)) {
            if (burst) Timestamp(time, Modifier.padding(top = 4.dp, bottom = 5.dp))
            content()
        }
        "rows" -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Box(Modifier.weight(1f)) { content() }
            Timestamp(time, Modifier.padding(start = 12.dp, top = 6.dp))
        }
        else -> Column {
            if (minuteMarker) Timestamp(time, Modifier.padding(top = 4.dp, bottom = 5.dp))
            content()
        }
    }
}

@Composable
private fun Timestamp(value: String?, modifier: Modifier = Modifier) {
    if (value != null) Text(value, modifier, style = MaterialTheme.typography.labelSmall, color = NotedStyle.colors.muted)
}
