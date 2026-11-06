package com.noted.android.ui

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.noted.android.R
import com.noted.android.data.*
import com.noted.android.features.auth.LoginScreen
import com.noted.android.features.home.HomeScreen
import com.noted.android.features.channels.ChannelScreen
import com.noted.android.features.channels.WorkspaceEditor
import com.noted.android.features.channels.PublishingSheet
import com.noted.android.features.search.SearchPanel
import com.noted.android.features.home.greeting
import com.noted.android.features.calendar.CalendarScreen
import com.noted.android.features.habits.HabitsScreen
import com.noted.android.features.settings.SettingsScreen
import com.noted.android.features.search.SearchScreen
import com.noted.android.features.nutrition.NutritionScreen
import com.noted.android.features.nutrition.LogMeal
import com.noted.android.features.ai.AssistantPanel
import com.noted.android.features.ai.LocalAskAi
import com.noted.android.features.ai.LocalAssistantOpen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import org.json.JSONObject

@Composable
fun NotedApp(repository: NativeRepository, destination: StateFlow<Uri?>, sharedPhotos: MutableStateFlow<List<Uri>>) {
    val session by repository.session.collectAsStateWithLifecycle()
    if (session == null) {
        NotedTheme { Surface(Modifier.fillMaxSize()) { LoginScreen(repository) } }
        return
    }
    key(session!!.partition) {
        var prepared by remember { mutableStateOf(false) }
        var cachedAppearance by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(session!!.partition) {
            cachedAppearance = repository.cached("/settings/appearance")
            if (repository.cached("/home/activity") != null) prepared = true
            else {
                withTimeoutOrNull(15_000) {
                    coroutineScope {
                        listOf("/home/activity", "/channels", "/workspaces?limit=200", "/time-tracking/tracker", "/settings/appearance").map { path -> async {
                            try { repository.fetch(path) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { }
                        } }.awaitAll()
                    }
                }
                cachedAppearance = repository.cached("/settings/appearance")
                prepared = true
            }
        }
        if (!prepared) {
            NotedTheme { AndroidView(factory = { StartupView(it) }, modifier = Modifier.fillMaxSize()) }
        } else {
            val appearance = rememberResource(repository, "/settings/appearance", cachedAppearance)
            NotedTheme(appearance.obj) { NativeWorkspace(repository, destination, sharedPhotos, appearance.obj) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeWorkspace(repository: NativeRepository, destination: StateFlow<Uri?>, sharedPhotos: MutableStateFlow<List<Uri>>, appearance: JSONObject?) {
    var route by rememberSaveable { mutableStateOf("home") }
    var selectedProject by rememberSaveable { mutableStateOf<String?>(null) }
    var trackerExpanded by rememberSaveable { mutableStateOf(false) }
    var lastChannel by rememberSaveable { mutableStateOf<String?>(null) }
    var editor by remember { mutableStateOf<JSONObject?>(null) }
    var assistant by rememberSaveable { mutableStateOf(false) }
    var logMeal by rememberSaveable { mutableStateOf(false) }
    var assistantMessage by remember { mutableStateOf<JSONObject?>(null) }
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var channelMenu by remember { mutableStateOf(false) }
    var publishing by remember { mutableStateOf<JSONObject?>(null) }
    val session by repository.session.collectAsStateWithLifecycle()
    val channels = rememberResource(repository, "/channels")
    val workspaces = rememberResource(repository, "/workspaces?limit=200")
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val draftError by repository.drafts.error.collectAsStateWithLifecycle()
    LaunchedEffect(draftError) { draftError?.let { snackbar.showSnackbar(it); repository.drafts.error.value = null } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val link by destination.collectAsStateWithLifecycle()
    var navigationJob by remember { mutableStateOf<Job?>(null) }
    var preparingChannel by remember { mutableStateOf(false) }
    val open: (String) -> Unit = { target ->
        navigationJob?.cancel()
        navigationJob = scope.launch {
            preparingChannel = target.startsWith("channel/")
            try {
                if (target.startsWith("channel/")) {
                    val id = channelId(target)!!
                    val location = channelLocation(target)
                    val item = channels.rows.firstOrNull { it.text("id") == id }
                    val path = "/channels/$id/" + when (item?.text("kind")) {
                        "journal" -> "journal?limit=50&offset=0"; "document" -> "document"
                        else -> "messages" + (location.message?.takeIf { location.thread == null }?.let { "?around=$it" } ?: "")
                    }
                    if (repository.cached(path) == null) repository.fetch(path)
                    location.entry?.let { if (repository.cached("/journal/$it") == null) repository.fetch("/journal/$it") }
                    location.thread?.let {
                        val threadPath = "/messages/$it/thread" + (location.message?.let { message -> "?around=$message" } ?: "")
                        if (repository.cached(threadPath) == null) repository.fetch(threadPath)
                    }
                }
                drawer.close()
                route = target
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { snackbar.showSnackbar(error.message ?: "Could not open this channel.") }
            finally { preparingChannel = false }
        }
    }
    DisposableEffect(session?.partition, lifecycle) {
        val live = LiveConnection(repository, scope)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) live.start()
            if (event == Lifecycle.Event.ON_STOP) live.stop()
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) live.start()
        onDispose { live.stop(); lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(link) {
        val incoming = link ?: return@LaunchedEffect
        val origin = repository.session.value?.origin ?: return@LaunchedEffect
        if (incoming.scheme == "noted" && incoming.host == "connection") { route = "settings/server"; return@LaunchedEffect }
        if (incoming.scheme == "noted" && incoming.host == "log-meal") { drawer.close(); logMeal = true; return@LaunchedEffect }
        if (incoming.scheme == "noted" && incoming.host == "tracker") { drawer.close(); route = "home"; trackerExpanded = true; return@LaunchedEffect }
        if (!repository.api.sameOrigin(incoming.toString())) {
            snackbar.showSnackbar("This link belongs to another server.")
            return@LaunchedEffect
        }
        val segments = incoming.pathSegments
        route = when {
            "c" in segments -> channelRoute(segments.getOrNull(segments.indexOf("c") + 1).orEmpty(), ChannelLocation(
                incoming.getQueryParameter("message"), incoming.getQueryParameter("thread"), incoming.getQueryParameter("entry")))
            "channels" in segments -> channelRoute(segments.getOrNull(segments.indexOf("channels") + 1).orEmpty(), ChannelLocation(
                incoming.getQueryParameter("message"), incoming.getQueryParameter("thread"), incoming.getQueryParameter("entry")))
            segments.firstOrNull() == "habits" -> "habits"
            segments.firstOrNull() == "nutrition" -> "nutrition"
            segments.firstOrNull() in listOf("calendar", "schedule") -> "calendar"
            else -> "home"
        }
        if (incoming.getQueryParameter("prompt") != null || incoming.getQueryParameter("planPrompt") != null) { route = "home"; trackerExpanded = true }
    }
    BackHandler(drawer.isOpen || assistant || trackerExpanded || route != "home") {
        when {
            drawer.isOpen -> scope.launch { drawer.close() }
            assistant -> { assistant = false; assistantMessage = null }
            trackerExpanded -> trackerExpanded = false
            else -> route = "home"
        }
    }
    val channel = channels.rows.firstOrNull { channelId(route) == it.text("id") }
    LaunchedEffect(route) { if (route.startsWith("channel/")) lastChannel = route }
    val title = channel?.text("name") ?: when (route.substringBefore('?').substringBefore('/')) {
        "calendar" -> "Calendar"; "habits" -> "Habits"; "nutrition" -> "Food"
        "search" -> "Search"; "library" -> "Library"; "settings" -> "Settings"; else -> greeting()
    }
    CompositionLocalProvider(LocalSnackbar provides snackbar, LocalNotedNavigate provides { target -> assistant = false; open(target) },
        LocalAskAi provides { message -> assistantMessage = message; assistant = true }, LocalAssistantOpen provides assistant) {
        ModalNavigationDrawer(drawerState = drawer, drawerContent = {
            ModalDrawerSheet(Modifier.width(308.dp), drawerShape = RectangleShape,
                drawerContainerColor = NotedStyle.colors.sidebar, drawerTonalElevation = 0.dp) {
                NotedSidebar(repository, workspaces.rows, channels.rows, route, open, selectedProject) { selectedProject = it }
            }
        }) {
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = {
                Column(Modifier.background(NotedStyle.colors.header).statusBarsPadding()) {
                    Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (route == "habits") IconButton({ route = "home" }, Modifier.size(44.dp)) {
                            Icon(NotedIcons.ArrowBack, "Back to Home", Modifier.size(22.dp), tint = NotedStyle.colors.secondary)
                        } else ActionIcon(NotedIcons.Menu, "Open sidebar") { scope.launch { drawer.open() } }
                        if (channel != null) Icon(NotedIcons.Tag, null, Modifier.size(18.dp), tint = NotedStyle.colors.muted)
                        Text(title, Modifier.weight(1f), maxLines = 1,
                            style = if (route == "habits") MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium)
                        if (preparingChannel) CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 2.dp)
                        if (route != "habits") ActionIcon(NotedIcons.Search, "Search notes") { searchOpen = true }
                        if (channel == null) ActionIcon(NotedIcons.Sparkles, "Ask AI") { assistantMessage = null; assistant = !assistant }
                        else Box {
                            ActionIcon(NotedIcons.MoreHorizontal, "Channel options") { channelMenu = true }
                            NotedPopover(channelMenu, { channelMenu = false }) {
                                Column(Modifier.width(200.dp).padding(5.dp)) {
                                    NotedListItem(headlineContent = { Text("Ask AI") }, modifier = Modifier.clickable {
                                        channelMenu = false; assistantMessage = null; assistant = true
                                    })
                                    NotedListItem(headlineContent = { Text("Channel settings") }, modifier = Modifier.clickable {
                                        channelMenu = false; editor = channel.copy().put("type", "channel")
                                    })
                                    if (channel.text("kind") !in listOf("journal", "document", "reminder")) NotedListItem(
                                        headlineContent = { Text("Scheduled messages") }, modifier = Modifier.clickable { channelMenu = false; publishing = channel })
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = NotedStyle.colors.subtle)
                }
            }, bottomBar = {
                val section = route.substringBefore('?').substringBefore('/')
                if (section in listOf("home", "nutrition", "calendar", "habits")) BottomNavigation(section) { target ->
                    when (target) {
                        "home" -> route = "home"
                        "notes" -> lastChannel?.let(open) ?: scope.launch { drawer.open() }
                        else -> open(target)
                    }
                }
            }) { padding ->
                BoxWithConstraints(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
                    Box(Modifier.fillMaxSize().padding(bottom = if (assistant) maxHeight * .5f else 0.dp)) {
                        key(route) {
                            when {
                                channel != null -> ChannelScreen(repository, channel, appearance, channelLocation(route)) { open(channelRoute(channel.text("id"))) }
                                route.startsWith("channel/") -> Column {
                                    ResourceStatus(channels) { repository.changed() }
                                    if (!channels.refreshing) EmptyState("Channel unavailable", "Open the sidebar to choose another channel.")
                                }
                                route.substringBefore('?') == "calendar" -> {
                                    val target = Uri.parse("noted://$route")
                                    CalendarScreen(repository, target.getQueryParameter("plan"), target.getQueryParameter("date"))
                                }
                                route == "habits" -> HabitsScreen(repository)
                                route == "nutrition" -> NutritionScreen(repository) { logMeal = true }
                                route == "search" || route == "library" -> SearchScreen(repository, route == "library", channels.rows, open)
                                route.startsWith("settings") -> SettingsScreen(repository, route.substringAfter('/', ""), open)
                                else -> HomeScreen(repository, channels.rows, workspaces.rows, open, { logMeal = true }, trackerExpanded,
                                    selectedProject ?: workspaces.rows.firstOrNull()?.text("id")) { trackerExpanded = it }
                            }
                        }
                    }
                    AssistantPanel(repository, assistant, assistantMessage, maxHeight) { assistant = false; assistantMessage = null }
                }
            }
        }
        editor?.let { item -> WorkspaceEditor(repository, item) { editor = null } }
        if (searchOpen) SearchPanel(repository, channels.rows, { searchOpen = false }) { target -> searchOpen = false; open(target) }
        publishing?.let { item -> PublishingSheet(repository, item) { publishing = null } }
        if (logMeal) {
            val shared by sharedPhotos.collectAsStateWithLifecycle()
            key(shared) {
                LogMeal(repository, shared, { logMeal = false; sharedPhotos.value = emptyList() }) { message -> scope.launch { snackbar.showSnackbar(message) } }
            }
        }
    }
}

/** Home, Notes, Food and Calendar stay one tap away on the top-level screens (phone home story 22). */
@Composable
private fun BottomNavigation(section: String, go: (String) -> Unit) {
    val colors = NotedStyle.colors
    Column(Modifier.background(colors.header).navigationBarsPadding()) {
        HorizontalDivider(color = colors.subtle)
        Row(Modifier.fillMaxWidth().height(64.dp)) {
            listOf(Triple("home", "Home", NotedIcons.Home), Triple("notes", "Notes", NotedIcons.MessageSquareText),
                Triple("nutrition", "Food", NotedIcons.Restaurant), Triple("calendar", "Calendar", NotedIcons.CalendarDays)).forEach { (target, label, icon) ->
                val active = section == target
                val tint = if (active) colors.accent else colors.faint
                Column(Modifier.weight(1f).fillMaxHeight().clickable(onClickLabel = label) { go(target) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Icon(icon, null, Modifier.size(22.dp), tint = tint)
                    Text(label, color = tint, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 3.dp))
                }
            }
        }
    }
}
