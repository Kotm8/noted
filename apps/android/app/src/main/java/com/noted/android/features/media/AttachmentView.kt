package com.noted.android.features.media

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import kotlinx.coroutines.delay
import androidx.media3.common.MediaItem
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import coil.ImageLoader
import coil.compose.SubcomposeAsyncImage
import coil.decode.ImageDecoderDecoder
import coil.decode.GifDecoder
import coil.disk.DiskCache
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject

@Composable
fun AttachmentView(repository: NativeRepository, attachment: JSONObject) {
    val context = LocalContext.current
    val actions = rememberActions()
    var viewer by remember { mutableStateOf(false) }
    val download = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) actions.run {
            withContext(Dispatchers.IO) {
                val api = repository.api
                api.transferClient.newCall(Request.Builder().url(api.url(attachment.text("download_url"))).build()).await().use { response ->
                    if (!response.isSuccessful) throw api.error(response)
                    context.contentResolver.openOutputStream(uri)?.use { output -> response.body!!.byteStream().use { it.copyTo(output, 65536) } }
                        ?: error("Could not open this destination.")
                }
            }
        }
    }
    val preview = attachment.text("preview_url")
    if (preview.isNotBlank()) {
        val ratio = if (attachment.optInt("height") > 0) attachment.optDouble("width") / attachment.optDouble("height") else 1.5
        NativeImage(repository, preview, attachment.text("original_filename"),
            Modifier.fillMaxWidth().aspectRatio(ratio.toFloat().coerceIn(.6f, 2.2f)).clickable { viewer = true })
    } else {
        NotedOutlinedButton(onClick = { if (attachment.text("playback_url").isNotBlank()) viewer = true else download.launch(attachment.text("original_filename")) }) {
            Icon(if (attachment.text("playback_url").isNotBlank()) NotedIcons.PlayCircle else NotedIcons.InsertDriveFile, null)
            Text(attachment.text("original_filename"), Modifier.padding(start = 8.dp), maxLines = 2)
        }
    }
    if (viewer) Dialog(onDismissRequest = { viewer = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Column {
                Row(Modifier.fillMaxWidth().safeDrawingPadding(), verticalAlignment = Alignment.CenterVertically) {
                    ActionIcon(NotedIcons.Close, "Close viewer") { viewer = false }
                    Text(attachment.text("original_filename"), Modifier.weight(1f), maxLines = 1)
                    ActionIcon(NotedIcons.Download, "Save original", enabled = !actions.busy) { download.launch(attachment.text("original_filename")) }
                }
                val playback = attachment.text("playback_url")
                if (playback.isNotBlank()) NativeVideo(repository, playback)
                else {
                    var zoom by remember { mutableFloatStateOf(1f) }
                    var x by remember { mutableFloatStateOf(0f) }
                    var y by remember { mutableFloatStateOf(0f) }
                    val transform = rememberTransformableState { scale, pan, _ -> zoom = (zoom * scale).coerceIn(1f, 8f); x += pan.x; y += pan.y }
                    Box(Modifier.weight(1f).fillMaxWidth().transformable(transform), contentAlignment = Alignment.Center) {
                        NativeImage(repository, attachment.text("original_url", preview), attachment.text("original_filename"),
                            Modifier.fillMaxSize().graphicsLayer(scaleX = zoom, scaleY = zoom, translationX = x, translationY = y), ContentScale.Fit)
                    }
                    NotedTextButton(onClick = { zoom = 1f; x = 0f; y = 0f }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Reset zoom") }
                }
            }
        }
    }
}

@Composable
fun NativeImage(repository: NativeRepository, path: String, description: String?, modifier: Modifier, scale: ContentScale = ContentScale.Crop) {
    val session by repository.session.collectAsStateWithLifecycle()
    val loader = remember(session?.partition) { repository.images() }
    val url = runCatching { repository.api.url(path) }.getOrNull()
    SubcomposeAsyncImage(model = url, imageLoader = loader, contentDescription = description, modifier = modifier,
        contentScale = scale, loading = { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer)) },
        error = { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
            Icon(NotedIcons.BrokenImage, "Image unavailable")
        } })
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun NativeVideo(repository: NativeRepository, path: String) {
    val context = LocalContext.current
    val player = remember(path) {
        ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(repository.api.client))).build().apply {
            setMediaItem(MediaItem.fromUri(repository.api.url(path))); prepare()
        }
    }
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0) }
    var duration by remember { mutableLongStateOf(0) }
    var failure by remember { mutableStateOf<String?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlayerError(error: PlaybackException) { failure = "This video could not be played. You can still save the original." }
        }
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        player.addListener(listener)
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); player.removeListener(listener); player.release() }
    }
    LaunchedEffect(player) {
        while (true) {
            position = player.currentPosition.coerceAtLeast(0)
            duration = player.duration.coerceAtLeast(0)
            delay(250)
        }
    }
    Column(Modifier.fillMaxSize()) {
        AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = false } }, modifier = Modifier.weight(1f).fillMaxWidth())
        failure?.let { QuietNotice(it, true) }
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionIcon(if (playing) NotedIcons.Pause else NotedIcons.PlayCircle, if (playing) "Pause video" else "Play video") {
                if (playing) player.pause() else { if (player.playbackState == Player.STATE_ENDED) player.seekTo(0); player.play() }
            }
            Text(playbackTime(position), style = MaterialTheme.typography.labelSmall)
            NotedSlider(if (duration > 0) position.toFloat() / duration else 0f,
                { if (duration > 0) player.seekTo((it * duration).toLong()) }, Modifier.weight(1f))
            Text(playbackTime(duration), style = MaterialTheme.typography.labelSmall)
        }
    }
}

private fun playbackTime(milliseconds: Long): String {
    val seconds = milliseconds / 1000
    return if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)
    else "%d:%02d".format(seconds / 60, seconds % 60)
}
