package com.noted.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.R
import com.noted.android.data.*
import com.noted.android.features.media.NativeImage
import org.json.JSONObject

@Composable
fun NotedSidebar(repository: NativeRepository, workspaces: List<JSONObject>, channels: List<JSONObject>, route: String,
    open: (String) -> Unit, edit: (JSONObject) -> Unit) {
    val colors = NotedStyle.colors
    var selectedId by remember { mutableStateOf<String?>(null) }
    val selected = workspaces.firstOrNull { it.text("id") == selectedId } ?: workspaces.firstOrNull()
    var menu by remember { mutableStateOf(false) }
    val channel = channels.firstOrNull { channelId(route) == it.text("id") }
    LaunchedEffect(channel?.text("workspace_id")) { channel?.let { selectedId = it.text("workspace_id") } }
    Row(Modifier.fillMaxSize().background(colors.sidebar)) {
        Column(Modifier.width(56.dp).fillMaxHeight().background(colors.rail), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.height(52.dp), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_brand), "Noted", Modifier.size(48.dp))
            }
            HorizontalDivider(Modifier.width(28.dp).padding(vertical = 8.dp), color = colors.subtle)
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally,
                contentPadding = PaddingValues(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(workspaces, key = { it.text("id") }) { workspace ->
                    val active = workspace.text("id") == selected?.text("id")
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        if (active) Box(Modifier.align(Alignment.CenterStart).width(3.dp).height(22.dp).background(colors.accent, RoundedCornerShape(2.dp)))
                        Box(Modifier.size(38.dp).background(if (active) colors.selected else colors.sidebar, RoundedCornerShape(9.dp))
                            .border(1.dp, if (active) colors.border else Color.Transparent, RoundedCornerShape(9.dp))
                            .clickable(role = Role.Tab) { selectedId = workspace.text("id") }
                            .semantics { contentDescription = "Project ${workspace.text("name")}"; this.selected = active }, contentAlignment = Alignment.Center) {
                            if (workspace.text("icon_url").isNotBlank()) NativeImage(repository, workspace.text("icon_url"), null, Modifier.size(34.dp))
                            else Text(workspace.text("icon", "N"), fontSize = 18.sp)
                        }
                    }
                }
            }
            Box(Modifier.padding(bottom = 12.dp)) { ActionIcon(NotedIcons.Add, "Add project") { edit(json("type" to "workspace")) } }
        }
        VerticalDivider(color = colors.subtle)
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Box {
                Row(Modifier.fillMaxWidth().height(52.dp).clickable { menu = true }.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(selected?.text("name") ?: "Noted", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Icon(NotedIcons.ChevronDown, null, Modifier.size(15.dp), tint = colors.muted)
                }
                NotedPopover(menu, { menu = false }) {
                    Column(Modifier.width(210.dp).padding(5.dp)) {
                        NotedListItem(headlineContent = { Text("Add project") }, modifier = Modifier.clickable {
                            menu = false; edit(json("type" to "workspace"))
                        })
                        if (selected != null) listOf("channel" to "Add channel", "category" to "Add category", "workspace" to "Project settings").forEach { (type, title) ->
                            NotedListItem(headlineContent = { Text(title) }, modifier = Modifier.clickable {
                                menu = false
                                edit(if (type == "workspace") selected.copy().put("type", type) else json("type" to type, "workspace_id" to selected.text("id")))
                            })
                        }
                    }
                }
            }
            HorizontalDivider(color = colors.subtle)
            Column(Modifier.padding(horizontal = 8.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                listOf(Triple("home", "Home", NotedIcons.Home), Triple("calendar", "Calendar", NotedIcons.CalendarDays),
                    Triple("habits", "Habits", NotedIcons.CheckBox), Triple("nutrition", "Food", NotedIcons.Restaurant),
                    Triple("library", "Library", NotedIcons.FolderOpen)).forEach { (path, label, icon) ->
                    NotedNavigationItem({ Text(label) }, route == path, { open(path) }, icon = { Icon(icon, null) })
                }
            }
            HorizontalDivider(Modifier.padding(horizontal = 12.dp), color = colors.subtle)
            if (selected != null) ProjectTree(repository, selected, channels, route, open, edit, Modifier.weight(1f))
            else Spacer(Modifier.weight(1f))
            HorizontalDivider(color = colors.subtle)
            Box(Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
                NotedNavigationItem({ Text("Settings") }, route.startsWith("settings"), { open("settings") }, icon = { Icon(NotedIcons.Settings, null) })
            }
        }
    }
}

@Composable
private fun ProjectTree(repository: NativeRepository, workspace: JSONObject, channels: List<JSONObject>, route: String,
    open: (String) -> Unit, edit: (JSONObject) -> Unit, modifier: Modifier) {
    val resource = rememberResource(repository, "/workspaces/${workspace.text("id")}/categories?limit=200")
    val projectChannels = channels.filter { it.text("workspace_id") == workspace.text("id") }
    var collapsed by remember(workspace.text("id")) { mutableStateOf(emptySet<String>()) }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp)) {
        (listOf<JSONObject?>(null) + resource.rows).forEach { category ->
            if (category != null) item(key = "category-${category.text("id")}") {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f).clickable { collapsed = if (category.text("id") in collapsed) collapsed - category.text("id") else collapsed + category.text("id") }
                        .padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (category.text("id") in collapsed) NotedIcons.ChevronRight else NotedIcons.ChevronDown, null, Modifier.size(12.dp), tint = NotedStyle.colors.muted)
                        Text(category.text("name"), Modifier.padding(start = 5.dp), style = MaterialTheme.typography.labelMedium, color = NotedStyle.colors.secondary)
                    }
                    ActionIcon(NotedIcons.MoreHorizontal, "Category settings") { edit(category.copy().put("type", "category")) }
                }
            }
            if (category?.text("id") !in collapsed) items(projectChannels.filter { it.text("category_id") == category?.text("id").orEmpty() }.sortedBy { it.optInt("position") }, key = { it.text("id") }) { channel ->
                NotedNavigationItem({ Text(channel.text("name"), maxLines = 1) }, channelId(route) == channel.text("id"), { open("channel/${channel.text("id")}") }, icon = {
                    Icon(when (channel.text("kind")) { "journal" -> NotedIcons.MenuBook; "document" -> NotedIcons.Description
                        "reminder" -> NotedIcons.Notifications; "tasks" -> NotedIcons.CheckBox; else -> NotedIcons.Tag }, null)
                })
            }
        }
    }
}
