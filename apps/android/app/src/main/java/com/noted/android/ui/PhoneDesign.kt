package com.noted.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The pieces the phone design (docs/design/phone/home-tiles-stories.html) is drawn with: pill
 * buttons and chips, uppercase section labels and the rounded bottom sheet. Phone screens use these
 * so they match the mockups exactly; the sizes and colours are the mockup's CSS values.
 */
@Composable
fun PillButton(onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = false, enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit) {
    val colors = NotedStyle.colors
    val shape = RoundedCornerShape(22.dp)
    val fill = if (primary) colors.accent else colors.floating
    Row(modifier.heightIn(min = 44.dp).clip(shape).background(if (enabled) fill else fill.copy(alpha = .45f))
        .border(1.dp, if (primary) colors.accent else colors.border, shape)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        CompositionLocalProvider(LocalContentColor provides if (primary) colors.accentText else colors.text,
            LocalTextStyle provides LocalTextStyle.current.copy(fontWeight = FontWeight.SemiBold, fontSize = 15.sp)) { content() }
    }
}

@Composable
fun PillChip(label: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = NotedStyle.colors
    val shape = RoundedCornerShape(18.dp)
    Box(modifier.height(36.dp).clip(shape).background(if (on) colors.accentSurface else Color.Transparent)
        .border(1.dp, if (on) colors.accent else colors.border, shape)
        .clickable(role = Role.RadioButton, onClick = onClick).semantics { selected = on }.padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center) {
        Text(label, color = if (on) colors.accent else colors.secondary, fontSize = 14.sp, maxLines = 1)
    }
}

@Composable
fun DesignLabel(text: String, modifier: Modifier = Modifier) = Text(text.uppercase(), modifier.padding(top = 20.dp, bottom = 8.dp),
    color = NotedStyle.colors.faint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .72.sp)

/** A bottom sheet sized to its content, with a drag handle and the title inside the body as in the mockups. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DesignSheet(close: () -> Unit, title: String, content: @Composable ColumnScope.() -> Unit) {
    val colors = NotedStyle.colors
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.floating, contentColor = colors.text, tonalElevation = 0.dp,
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
        dragHandle = { Box(Modifier.padding(top = 12.dp, bottom = 10.dp).size(36.dp, 4.dp).background(colors.border, RoundedCornerShape(2.dp))) }) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 28.dp).navigationBarsPadding()) {
            Text(title, color = colors.text, fontSize = MaterialTheme.typography.bodyLarge.fontSize * (17f / 15f), fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
