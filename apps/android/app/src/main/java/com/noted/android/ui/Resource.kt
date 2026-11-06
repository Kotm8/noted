package com.noted.android.ui

import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.noted.android.data.NativeRepository
import com.noted.android.data.objects
import com.noted.android.data.topicFor
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

data class Resource(val raw: String? = null, val refreshing: Boolean = false, val error: String? = null) {
    val obj: JSONObject? get() = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
    val rows: List<JSONObject> get() = raw?.let { runCatching { JSONArray(it).objects() }.getOrNull() }.orEmpty()
}

@Composable
fun rememberResource(repository: NativeRepository, path: String?, initialRaw: String? = null): Resource {
    val session by repository.session.collectAsStateWithLifecycle()
    val versions by repository.changes.collectAsStateWithLifecycle()
    val epoch = (versions["all"] ?: 0) + (versions[topicFor(path)] ?: 0)
    var state by remember(path, session?.partition) { mutableStateOf(Resource(raw = initialRaw)) }
    LaunchedEffect(path, epoch) {
        if (path == null) return@LaunchedEffect
        repository.cached(path)?.let { state = state.copy(raw = it) }
        state = state.copy(refreshing = true)
        try {
            state = Resource(repository.fetch(path))
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { state = state.copy(refreshing = false, error = error.message ?: "Could not refresh.") }
    }
    return state
}
