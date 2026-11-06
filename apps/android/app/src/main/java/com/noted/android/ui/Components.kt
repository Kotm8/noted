package com.noted.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.state.ToggleableState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

@Composable
fun ActionIcon(icon: ImageVector, label: String, enabled: Boolean = true, action: () -> Unit) {
    NotedTextButton(action, Modifier.size(32.dp).semantics { contentDescription = label }, enabled, PaddingValues(7.dp)) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun QuietNotice(text: String, error: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(if (error) NotedIcons.CloudOff else NotedIcons.Info, null, Modifier.size(17.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun ResourceStatus(resource: Resource, retry: () -> Unit) {
    if (resource.error != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { QuietNotice(if (resource.raw != null) "Showing saved content. ${resource.error}" else resource.error, true) }
            ActionIcon(NotedIcons.Refresh, "Retry", action = retry)
        }
    } else if (resource.raw == null && resource.refreshing) {
        LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(text, Modifier.padding(top = 20.dp, bottom = 8.dp),
        style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun EmptyState(title: String, description: String) {
    Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun Field(label: String, value: String, change: (String) -> Unit, modifier: Modifier = Modifier,
    singleLine: Boolean = true) {
    NotedTextField(value, change, modifier.fillMaxWidth(), label = { Text(label) }, singleLine = singleLine, fieldLabel = label)
}

@Composable
fun <T> Choice(label: String, value: T, options: List<Pair<T, String>>, change: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var width by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val colors = NotedStyle.colors
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        if (label.isNotBlank()) Text(label, style = MaterialTheme.typography.labelLarge, color = colors.secondary)
        Box {
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).onSizeChanged { width = it.width }.background(colors.main, RoundedCornerShape(4.dp))
                .border(1.dp, colors.border, RoundedCornerShape(4.dp)).clickable(role = Role.DropdownList) { expanded = true }
                .semantics { contentDescription = label.ifBlank { "Choose value" }; stateDescription = options.firstOrNull { it.first == value }?.second.orEmpty() }
                .padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(options.firstOrNull { it.first == value }?.second.orEmpty(), Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.bodyMedium)
                Icon(NotedIcons.ChevronDown, null, Modifier.size(14.dp), tint = colors.muted)
            }
            NotedPopover(expanded, { expanded = false }) {
                Column(Modifier.width(with(density) { width.toDp() }.coerceIn(76.dp, 300.dp)).heightIn(max = 280.dp).verticalScroll(rememberScrollState()).padding(4.dp)) {
                    options.forEach { (key, title) ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 32.dp).background(if (key == value) colors.selected else Color.Transparent, RoundedCornerShape(3.dp))
                            .clickable(role = Role.Button) { change(key); expanded = false }.padding(horizontal = 9.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            if (key == value) Icon(NotedIcons.Check, null, Modifier.size(14.dp))
                        }
                    }
                }
            }
        }
    }
}

fun minuteLabel(minute: Int): String = "%02d:%02d".format(minute / 60, minute % 60)

@Composable
fun TimeField(label: String, minute: Int, change: (Int) -> Unit) {
    val hours = if (label.lowercase().contains("end")) 0..24 else 0..23
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = NotedStyle.colors.secondary)
        Row(Modifier.width(180.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) {
                Choice("", minute / 60, hours.map { it to "%02d".format(it) }) { hour -> change(hour * 60 + if (hour == 24) 0 else minute % 60) }
            }
            Text(":", color = NotedStyle.colors.muted)
            Box(Modifier.weight(1f)) {
                Choice("", minute % 60, (if (minute / 60 == 24) 0..0 else 0..59).map { it to "%02d".format(it) }) { change(minute / 60 * 60 + it) }
            }
        }
    }
}

@Composable
fun DateField(label: String, date: LocalDate, change: (LocalDate) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = NotedStyle.colors.secondary)
        Box {
            NotedOutlinedButton({ expanded = true }, Modifier.fillMaxWidth()) {
                Icon(NotedIcons.CalendarDays, null, Modifier.size(16.dp))
                Text(date.format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy")), Modifier.weight(1f).padding(horizontal = 9.dp))
                Icon(NotedIcons.ChevronDown, null, Modifier.size(14.dp))
            }
            NotedPopover(expanded, { expanded = false }) {
                NotedDatePicker(date) { change(it); expanded = false }
            }
        }
    }
}

@Composable
fun Toggle(label: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 38.dp).clickable(role = Role.Switch) { change(!value) }
        .semantics { toggleableState = if (value) ToggleableState.On else ToggleableState.Off },
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        val colors = NotedStyle.colors
        Box(Modifier.width(29.dp).height(16.dp).background(if (value) colors.accent.copy(alpha = .25f) else colors.main, RoundedCornerShape(8.dp))
            .border(1.dp, if (value) colors.accent else colors.border, RoundedCornerShape(8.dp)).padding(3.dp)) {
            Box(Modifier.size(10.dp).align(if (value) Alignment.CenterEnd else Alignment.CenterStart)
                .background(if (value) colors.accent else colors.muted, RoundedCornerShape(5.dp)))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorSheet(title: String, close: () -> Unit, confirm: String = "Save", enabled: Boolean = true,
    save: suspend () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    NotedSheet(onDismissRequest = { if (!saving) close() }, title = title, dismissEnabled = !saving) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.85f).imePadding()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                content()
                error?.let { QuietNotice(it, true) }
            }
            HorizontalDivider(color = NotedStyle.colors.subtle)
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NotedOutlinedButton(close, enabled = !saving) { Text("Cancel") }
                NotedButton(onClick = {
                    saving = true; error = null
                    scope.launch {
                        try { save(); close() }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { error = failure.message ?: "Could not save. Your changes are still here." }
                        finally { saving = false }
                    }
                }, enabled = enabled && !saving) {
                    if (saving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(confirm)
                }
            }
        }
    }
}

@Composable
fun ConfirmDelete(title: String, close: () -> Unit, remove: suspend () -> Unit) {
    EditorSheet(title, close, "Delete", save = remove) { Text("This removes the item from your server and all connected devices.") }
}
