package com.noted.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.R
import com.noted.android.data.*
import com.noted.android.features.home.channelIcon
import com.noted.android.features.media.NativeImage
import org.json.JSONObject

/**
 * Every project in a rail, with the chosen project's channels in foldable categories and the pinned
 * channels above them (phone home story 1). Projects and channels are created and edited on the web,
 * so the only change made here is pinning, from a long-press.
 */
@Composable
fun NotedSidebar(repository: NativeRepository, workspaces: List<JSONObject>, channels: List<JSONObject>, route: String,
    open: (String) -> Unit, selectedId: String?, selectProject: (String) -> Unit) {
    val colors = NotedStyle.colors
    val selected = workspaces.firstOrNull { it.text("id") == selectedId } ?: workspaces.firstOrNull()
    var pressed by remember { mutableStateOf<JSONObject?>(null) }
    val channel = channels.firstOrNull { channelId(route) == it.text("id") }
    LaunchedEffect(channel?.text("workspace_id")) { channel?.let { selectProject(it.text("workspace_id")) } }
    val pinned = channels.filter { it.text("pinned_at").isNotBlank() }.sortedBy { it.text("pinned_at") }
    Row(Modifier.fillMaxSize().background(colors.sidebar)) {
        Column(Modifier.width(64.dp).fillMaxHeight().background(colors.rail), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.height(56.dp), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_brand), "Noted", Modifier.size(44.dp))
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally,
                contentPadding = PaddingValues(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(workspaces, key = { it.text("id") }) { workspace ->
                    val active = workspace.text("id") == selected?.text("id")
                    Box(Modifier.fillMaxWidth().height(52.dp), contentAlignment = Alignment.Center) {
                        if (active) Box(Modifier.align(Alignment.CenterStart).width(4.dp).height(28.dp).background(colors.accent, RoundedCornerShape(2.dp)))
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(if (active) 14.dp else 22.dp))
                            .background(if (active) colors.selected else colors.floating)
                            .border(1.dp, if (active) colors.border else Color.Transparent, RoundedCornerShape(if (active) 14.dp else 22.dp))
                            .clickable(role = Role.Tab) { selectProject(workspace.text("id")) }
                            .semantics { contentDescription = "Project ${workspace.text("name")}"; this.selected = active }, contentAlignment = Alignment.Center) {
                            if (workspace.text("icon_url").isNotBlank()) NativeImage(repository, workspace.text("icon_url"), null, Modifier.size(40.dp))
                            else Text(workspace.text("icon", "N"), fontSize = 18.sp)
                        }
                    }
                }
            }
        }
        VerticalDivider(color = colors.subtle)
        LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 12.dp)) {
            listOf("home" to "Home", "calendar" to "Calendar", "habits" to "Habits", "nutrition" to "Nutrition", "library" to "Library").forEach { (path, label) ->
                item(key = path) {
                    val icon = when (path) { "home" -> NotedIcons.Home; "calendar" -> NotedIcons.CalendarDays; "habits" -> NotedIcons.CheckBox
                        "nutrition" -> NotedIcons.Restaurant; else -> NotedIcons.FolderOpen }
                    DrawerRow(label, { Icon(icon, null) }, route == path, { open(path) })
                }
            }
            if (pinned.isNotEmpty()) {
                item(key = "pinned-title") { DrawerLabel("Pinned") }
                items(pinned, key = { "pinned-${it.text("id")}" }) { item ->
                    DrawerRow(item.text("name"), { Icon(NotedIcons.PushPin, null) }, false, { open(channelRoute(item.text("id"))) }) { pressed = item }
                }
            }
            if (selected != null) {
                item(key = "project") {
                    HorizontalDivider(Modifier.padding(start = 10.dp, end = 10.dp, top = 14.dp), color = colors.subtle)
                    Text(selected.text("name"), Modifier.padding(start = 10.dp, top = 14.dp, bottom = 4.dp), color = colors.text,
                        fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                projectTree(repository, selected, channels, route, open) { pressed = it }
            }
            item(key = "settings") {
                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = colors.subtle)
                DrawerRow("Settings", { Icon(NotedIcons.Settings, null) }, route.startsWith("settings"), { open("settings") })
            }
        }
    }
    pressed?.let { item -> ChannelMenu(repository, item, workspaces) { pressed = null } }
}

@Composable
private fun DrawerLabel(text: String) = Text(text.uppercase(), Modifier.padding(start = 10.dp, top = 16.dp, bottom = 4.dp),
    color = NotedStyle.colors.faint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .8.sp)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DrawerRow(label: String, icon: @Composable () -> Unit, selected: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)? = null) {
    val colors = NotedStyle.colors
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp))
        .background(if (selected) colors.selected else Color.Transparent)
        .combinedClickable(onClick = onClick, onLongClick = onLongClick, onLongClickLabel = onLongClick?.let { "Channel options" })
        .semantics { this.selected = selected }.padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        CompositionLocalProvider(LocalContentColor provides if (selected) colors.accent else colors.muted) {
            Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) { icon() }
        }
        Text(label, Modifier.weight(1f), color = if (selected) colors.text else colors.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal))
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.projectTree(repository: NativeRepository, workspace: JSONObject,
    channels: List<JSONObject>, route: String, open: (String) -> Unit, press: (JSONObject) -> Unit) {
    item(key = "tree-${workspace.text("id")}") { ProjectTree(repository, workspace, channels, route, open, press) }
}

@Composable
private fun ProjectTree(repository: NativeRepository, workspace: JSONObject, channels: List<JSONObject>, route: String,
    open: (String) -> Unit, press: (JSONObject) -> Unit) {
    val colors = NotedStyle.colors
    val resource = rememberResource(repository, "/workspaces/${workspace.text("id")}/categories?limit=200")
    val projectChannels = channels.filter { it.text("workspace_id") == workspace.text("id") }
    var collapsed by remember(workspace.text("id")) { mutableStateOf(emptySet<String>()) }
    Column {
        (listOf<JSONObject?>(null) + resource.rows).forEach { category ->
            val members = projectChannels.filter { it.text("category_id") == category?.text("id").orEmpty() }.sortedBy { it.optInt("position") }
            val folded = category != null && category.text("id") in collapsed
            if (category != null) Row(Modifier.fillMaxWidth().padding(top = 6.dp).height(36.dp).clip(RoundedCornerShape(8.dp))
                .clickable(onClickLabel = if (folded) "Show ${category.text("name")}" else "Hide ${category.text("name")}") {
                    collapsed = if (folded) collapsed - category.text("id") else collapsed + category.text("id")
                }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(NotedIcons.ChevronDown, null, Modifier.size(16.dp).rotate(if (folded) -90f else 0f), tint = colors.faint)
                Text(category.text("name"), Modifier.weight(1f), color = colors.secondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                if (folded) Text("${members.size}", color = colors.muted, fontSize = 13.sp)
            }
            if (!folded) members.forEach { item ->
                DrawerRow(item.text("name"), { Icon(channelIcon(item.text("kind")), null) }, channelId(route) == item.text("id"),
                    { open(channelRoute(item.text("id"))) }) { press(item) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChannelMenu(repository: NativeRepository, channel: JSONObject, workspaces: List<JSONObject>, close: () -> Unit) {
    val actions = rememberActions()
    val context = LocalContext.current
    val pinned = channel.text("pinned_at").isNotBlank()
    val project = workspaces.firstOrNull { it.text("id") == channel.text("workspace_id") }
    NotedSheet(close, title = channel.text("name")) {
        Column(Modifier.padding(8.dp).navigationBarsPadding()) {
            project?.let { Text(it.text("name"), Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = NotedStyle.colors.muted, fontSize = 13.sp) }
            NotedListItem(headlineContent = { Text(if (pinned) "Unpin from Home" else "Pin to Home") }, leadingContent = { Icon(NotedIcons.PushPin, null) },
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = !actions.busy) {
                    actions.run { repository.mutate("/channels/${channel.text("id")}/pin", "PUT", json("pinned" to !pinned)); repository.changed(); close() }
                })
            NotedListItem(headlineContent = { Text("Open on the web") }, leadingContent = { Icon(NotedIcons.ExternalLink, null) },
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable {
                    repository.session.value?.origin?.let { openOnWeb(context, it, "/w/${channel.text("workspace_id")}/c/${channel.text("id")}") }
                    close()
                })
        }
    }
}
