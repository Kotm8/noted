package com.noted.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

@Composable
fun NotedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 8.dp), content: @Composable RowScope.() -> Unit) {
    ButtonSurface(onClick, modifier, enabled, contentPadding, primary = true, content = content)
}

@Composable
fun NotedOutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 12.dp, vertical = 8.dp), content: @Composable RowScope.() -> Unit) {
    ButtonSurface(onClick, modifier, enabled, contentPadding, outlined = true, content = content)
}

@Composable
fun NotedTextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 8.dp, vertical = 7.dp), content: @Composable RowScope.() -> Unit) {
    ButtonSurface(onClick, modifier, enabled, contentPadding, content = content)
}

@Composable
private fun ButtonSurface(onClick: () -> Unit, modifier: Modifier, enabled: Boolean, padding: PaddingValues,
    primary: Boolean = false, outlined: Boolean = false, content: @Composable RowScope.() -> Unit) {
    val colors = NotedStyle.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(4.dp)
    val background = when {
        primary -> if (enabled) colors.accent else colors.selected
        pressed && enabled -> colors.hover
        else -> Color.Transparent
    }
    val foreground = when { !enabled -> colors.muted.copy(alpha = .55f); primary -> colors.accentText; else -> colors.text }
    Row(modifier.heightIn(min = 34.dp).clip(shape).background(background)
        .border(1.dp, if (focused) colors.accent else if (outlined) colors.border else Color.Transparent, shape)
        .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick).padding(padding),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        CompositionLocalProvider(LocalContentColor provides foreground) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium)) { content() }
        }
    }
}

@Composable
fun NotedFilledIconButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable () -> Unit) {
    NotedButton(onClick, modifier.size(34.dp), enabled, PaddingValues(7.dp)) { content() }
}

@Composable
fun NotedTextField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    label: @Composable (() -> Unit)? = null, placeholder: @Composable (() -> Unit)? = null,
    singleLine: Boolean = false, maxLines: Int = Int.MAX_VALUE, enabled: Boolean = true,
    readOnly: Boolean = false, visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default,
    fieldLabel: String? = null, chrome: Boolean = true) {
    val colors = NotedStyle.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        if (label != null) ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(color = colors.secondary)) { label() }
        BasicTextField(value, onValueChange, modifier = Modifier.fillMaxWidth().heightIn(min = if (chrome) 40.dp else 24.dp)
            .then(if (chrome) Modifier.background(colors.main, RoundedCornerShape(4.dp))
                .border(1.dp, if (focused) colors.accent else colors.border, RoundedCornerShape(4.dp))
                .padding(horizontal = 11.dp, vertical = 9.dp) else Modifier.padding(horizontal = 6.dp, vertical = 5.dp))
            .semantics { fieldLabel?.let { contentDescription = it } },
            enabled = enabled, readOnly = readOnly, singleLine = singleLine, maxLines = if (singleLine) 1 else maxLines,
            interactionSource = interaction, textStyle = MaterialTheme.typography.bodyMedium.copy(color = colors.text),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.accent), visualTransformation = visualTransformation,
            keyboardOptions = keyboardOptions, keyboardActions = keyboardActions, decorationBox = { inner ->
                Box {
                    if (value.isEmpty() && placeholder != null) CompositionLocalProvider(LocalContentColor provides colors.muted) {
                        ProvideTextStyle(MaterialTheme.typography.bodyMedium) { placeholder() }
                    }
                    inner()
                }
            })
    }
}

@Composable
fun NotedCheckbox(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier) {
    val colors = NotedStyle.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(modifier.size(30.dp).semantics {
        role = Role.Checkbox; toggleableState = if (checked) ToggleableState.On else ToggleableState.Off
        if (onCheckedChange == null) disabled()
    }.then(if (onCheckedChange != null) Modifier.toggleable(checked, interactionSource = interaction, indication = null,
        role = Role.Checkbox, onValueChange = onCheckedChange) else Modifier), contentAlignment = Alignment.Center) {
        Box(Modifier.size(17.dp).background(if (checked) colors.accent else Color.Transparent, RoundedCornerShape(3.dp))
            .border(1.dp, if (checked || focused) colors.accent else colors.muted, RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) {
            if (checked) Icon(NotedIcons.Check, null, Modifier.size(13.dp), tint = colors.accentText)
        }
    }
}

@Composable
fun NotedFilterChip(selected: Boolean, onClick: () -> Unit, label: @Composable () -> Unit, modifier: Modifier = Modifier) {
    val colors = NotedStyle.colors
    Box(modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(4.dp)).background(if (selected) colors.selected else Color.Transparent)
        .border(1.dp, if (selected) colors.muted else colors.border, RoundedCornerShape(4.dp))
        .clickable(role = Role.Checkbox, onClick = onClick).semantics { this.selected = selected }.padding(horizontal = 8.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center) { ProvideTextStyle(MaterialTheme.typography.labelMedium) { label() } }
}

@Composable
fun NotedNavigationItem(label: @Composable () -> Unit, selected: Boolean, onClick: () -> Unit,
    modifier: Modifier = Modifier, icon: @Composable (() -> Unit)? = null) {
    val colors = NotedStyle.colors
    Row(modifier.fillMaxWidth().heightIn(min = 36.dp).clip(RoundedCornerShape(4.dp))
        .background(if (selected) colors.selected else Color.Transparent)
        .clickable(role = Role.Tab, onClick = onClick).semantics { this.selected = selected }.padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        CompositionLocalProvider(LocalContentColor provides if (selected) colors.text else colors.secondary) {
            if (icon != null) Box(Modifier.size(17.dp), contentAlignment = Alignment.Center) { icon() }
            ProvideTextStyle(MaterialTheme.typography.bodyMedium.copy(fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal)) { label() }
        }
    }
}

@Composable
fun NotedListItem(headlineContent: @Composable () -> Unit, modifier: Modifier = Modifier,
    supportingContent: @Composable (() -> Unit)? = null, leadingContent: @Composable (() -> Unit)? = null,
    trailingContent: @Composable (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 8.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
        if (leadingContent != null) Box(Modifier.size(19.dp), contentAlignment = Alignment.Center) {
            CompositionLocalProvider(LocalContentColor provides NotedStyle.colors.secondary) { leadingContent() }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            ProvideTextStyle(MaterialTheme.typography.bodyMedium) { headlineContent() }
            if (supportingContent != null) ProvideTextStyle(MaterialTheme.typography.bodySmall.copy(color = NotedStyle.colors.muted)) { supportingContent() }
        }
        if (trailingContent != null) trailingContent()
    }
}

@Composable
fun NotedSlider(value: Float, onValueChange: (Float) -> Unit, modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f, steps: Int = 0) {
    val colors = NotedStyle.colors
    val currentChange by rememberUpdatedState(onValueChange)
    fun snapped(next: Float): Float {
        val ratio = ((next - valueRange.start) / (valueRange.endInclusive - valueRange.start)).coerceIn(0f, 1f)
        return valueRange.start + (if (steps > 0) (ratio * (steps + 1)).roundToInt().toFloat() / (steps + 1) else ratio) * (valueRange.endInclusive - valueRange.start)
    }
    Canvas(modifier.fillMaxWidth().height(30.dp).semantics {
        progressBarRangeInfo = ProgressBarRangeInfo(value, valueRange, steps)
        setProgress { currentChange(snapped(it)); true }
    }.onKeyEvent {
        if (it.type == KeyEventType.KeyDown && it.key in listOf(Key.DirectionLeft, Key.DirectionRight)) {
            val step = (valueRange.endInclusive - valueRange.start) / if (steps > 0) steps + 1 else 100
            currentChange(snapped(value + if (it.key == Key.DirectionRight) step else -step)); true
        } else false
    }.focusable().pointerInput(valueRange, steps) {
        awaitEachGesture {
            val down = awaitFirstDown()
            fun move(x: Float) { currentChange(snapped(valueRange.start + (x / size.width).coerceIn(0f, 1f) * (valueRange.endInclusive - valueRange.start))) }
            move(down.position.x); down.consume()
            do {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (change.pressed) { move(change.position.x); change.consume() }
            } while (event.changes.any { it.pressed })
        }
    }) {
        val ratio = ((value - valueRange.start) / (valueRange.endInclusive - valueRange.start)).coerceIn(0f, 1f)
        drawLine(colors.border, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), 2.dp.toPx())
        drawLine(colors.accent, Offset(0f, size.height / 2), Offset(size.width * ratio, size.height / 2), 2.dp.toPx())
        drawCircle(colors.accent, 5.dp.toPx(), Offset((size.width * ratio).coerceIn(5.dp.toPx(), size.width - 5.dp.toPx()), size.height / 2))
    }
}

@Composable
fun NotedProgressIndicator(progress: () -> Float, modifier: Modifier = Modifier) {
    val colors = NotedStyle.colors
    Box(modifier.fillMaxWidth().height(2.dp).background(colors.border)) {
        Box(Modifier.fillMaxWidth(progress().coerceIn(0f, 1f)).fillMaxHeight().background(colors.accent))
    }
}
