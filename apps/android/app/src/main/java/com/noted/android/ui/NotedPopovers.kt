package com.noted.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun NotedPopover(open: Boolean, close: () -> Unit, content: @Composable () -> Unit) {
    if (!open) return
    val colors = NotedStyle.colors
    val position = remember { object : PopupPositionProvider {
        override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection,
            popupContentSize: IntSize): IntOffset {
            val margin = 12
            val x = if (layoutDirection == LayoutDirection.Ltr) anchorBounds.left else anchorBounds.right - popupContentSize.width
            val below = anchorBounds.bottom + 8
            val y = if (below + popupContentSize.height <= windowSize.height - margin) below else anchorBounds.top - popupContentSize.height - 8
            return IntOffset(x.coerceIn(margin, (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin)),
                y.coerceIn(margin, (windowSize.height - popupContentSize.height - margin).coerceAtLeast(margin)))
        }
    } }
    Popup(position, onDismissRequest = close, properties = PopupProperties(focusable = true)) {
        Box(Modifier.background(colors.floating, RoundedCornerShape(6.dp)).border(1.dp, colors.border, RoundedCornerShape(6.dp))) { content() }
    }
}

@Composable
fun NotedDatePicker(selected: LocalDate, choose: (LocalDate) -> Unit) {
    var month by remember(selected) { mutableStateOf(YearMonth.from(selected)) }
    val colors = NotedStyle.colors
    Column(Modifier.width(292.dp).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            ActionIcon(NotedIcons.ChevronLeft, "Previous month") { month = month.minusMonths(1) }
            Box(Modifier.weight(1f)) {
                Choice("", month.monthValue, (1..12).map { it to java.time.Month.of(it).getDisplayName(TextStyle.FULL, Locale.getDefault()) }) { month = YearMonth.of(month.year, it) }
            }
            Box(Modifier.width(74.dp)) {
                Choice("", month.year, (LocalDate.now().year - 10..LocalDate.now().year + 10).map { it to it.toString() }) { month = YearMonth.of(it, month.month) }
            }
            ActionIcon(NotedIcons.ChevronRight, "Next month") { month = month.plusMonths(1) }
        }
        Row {
            listOf("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su").forEach { day -> Box(Modifier.weight(1f).height(28.dp), contentAlignment = Alignment.Center) {
                Text(day, style = MaterialTheme.typography.labelSmall, color = colors.muted)
            } }
        }
        val offset = month.atDay(1).dayOfWeek.value - 1
        val cells = ((offset + month.lengthOfMonth() + 6) / 7) * 7
        for (row in 0 until cells / 7) Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            for (column in 0..6) {
                val number = row * 7 + column - offset + 1
                if (number !in 1..month.lengthOfMonth()) Spacer(Modifier.weight(1f).height(34.dp))
                else {
                    val date = month.atDay(number)
                    Box(Modifier.weight(1f).height(34.dp).background(if (date == selected) colors.accent else Color.Transparent, RoundedCornerShape(4.dp))
                        .clickable(role = Role.Button) { choose(date) }.semantics { contentDescription = "Choose $date"; this.selected = date == selected },
                        contentAlignment = Alignment.Center) {
                        Text(number.toString(), color = if (date == selected) colors.accentText else colors.text, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotedSheet(onDismissRequest: () -> Unit, sheetState: SheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    title: String? = null, dismissEnabled: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val colors = NotedStyle.colors
    ModalBottomSheet(onDismissRequest = onDismissRequest, sheetState = sheetState, containerColor = colors.floating,
        contentColor = colors.text, tonalElevation = 0.dp, shape = RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp),
        dragHandle = null, scrimColor = Color.Black.copy(alpha = .55f)) {
        Row(Modifier.fillMaxWidth().height(48.dp).padding(start = 20.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            ActionIcon(NotedIcons.Close, "Close panel", dismissEnabled, onDismissRequest)
        }
        HorizontalDivider(color = colors.subtle)
        content()
    }
}
