package com.noted.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import java.time.ZonedDateTime
import java.time.Duration
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReminderTimePicker(value: ZonedDateTime, change: (ZonedDateTime) -> Unit) {
    val now = remember(value.zone) { ZonedDateTime.now(value.zone).withSecond(0).withNano(0) }
    var customDate by remember { mutableStateOf(false) }
    val evening = now.withHour(18).withMinute(0).let { if (it <= now) it.plusDays(1) else it }
    val choices = listOf("In 1 hour" to now.plusHours(1), "In 3 hours" to now.plusHours(3),
        "This evening" to evening, "Tomorrow morning" to now.plusDays(1).withHour(9).withMinute(0))
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value.format(DateTimeFormatter.ofPattern("HH:mm")), fontSize = MaterialTheme.typography.bodyLarge.fontSize * (44f / 15f), fontWeight = FontWeight.Light)
        Text(when (value.toLocalDate()) {
            now.toLocalDate() -> "Today"
            now.toLocalDate().plusDays(1) -> "Tomorrow"
            else -> value.format(DateTimeFormatter.ofPattern("EEEE, d MMMM"))
        }, color = NotedStyle.colors.muted, style = MaterialTheme.typography.bodySmall)
    }
    FlowRow(Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        choices.forEach { (label, time) -> PillChip(label, value.toInstant() == time.toInstant(), { change(time) }) }
    }
    val minute = value.hour * 60 + value.minute
    val ahead = Duration.between(now, value).toMinutes().coerceIn(0, 1440)
    NotedSlider(ahead.toFloat(), { raw ->
        val selected = ((raw / 5).roundToInt() * 5).coerceIn(0, 1440)
        change(now.plusMinutes(selected.toLong()))
    }, valueRange = 0f..1440f)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        listOf("Now", "+12 h", "+24 h").forEach { Text(it, color = NotedStyle.colors.faint, style = MaterialTheme.typography.labelSmall) }
    }
    TimeField("Exact time", minute) { change(value.toLocalDate().atTime(LocalTime.of(it / 60, it % 60)).atZone(value.zone)) }
    if (customDate) DateField("Other date", value.toLocalDate()) { change(it.atTime(value.toLocalTime()).atZone(value.zone)) }
    else NotedTextButton({ customDate = true }) { Icon(NotedIcons.CalendarDays, null, Modifier.size(16.dp)); Text("Other date", Modifier.padding(start = 8.dp)) }
}
