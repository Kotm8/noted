package com.noted.android.features.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import com.noted.android.watch.WatchPairingActivity
import org.json.JSONObject

@Composable
fun WatchSettings(repository: NativeRepository) {
    val resource = rememberResource(repository, "/wear/settings")
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    val value = draft ?: resource.obj
    val actions = rememberActions()
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Watch", style = MaterialTheme.typography.titleLarge)
        Text("Install Noted on your watch and keep it connected to this phone.")
        NotedButton(onClick = { actions.run {
            val pairing = JSONObject(repository.mutate("/wear/pairings"))
            val uri = Uri.Builder().scheme("noted").authority("watch").path("/connect")
                .appendQueryParameter("origin", repository.session.value!!.origin).appendQueryParameter("ticket", pairing.text("ticket")).build()
            context.startActivity(Intent(context, WatchPairingActivity::class.java).setData(uri))
        } }, enabled = !actions.busy) { Text("Pair watch") }
        ResourceStatus(resource) { repository.changed() }
        if (value != null) {
            fun set(key: String, item: Any) { draft = value.copy().put(key, item) }
            Choice("Layout", value.text("face", "W16"), listOf("W07" to "Next up", "W16" to "Quiet queue", "W24" to "Above / below")) { set("face", it) }
            Text("Text scale")
            NotedSlider(value.optDouble("text_scale", 1.0).toFloat(), { set("text_scale", it.toDouble()) }, valueRange = .85f..1.3f)
            Choice("Schedule ahead", value.optInt("schedule_hours", 4), listOf(2, 4, 6, 8).map { it to "$it hours" }) { set("schedule_hours", it) }
            Toggle("Hide notification contents", value.optBoolean("hide_contents")) { set("hide_contents", it) }
            Field("Accent", value.text("accent", "#e2c15a"), { set("accent", it) })
            NotedButton(onClick = { actions.run { repository.mutate("/wear/settings", "PUT", value); draft = null } }, enabled = draft != null && !actions.busy) { Text("Save watch settings") }
        }
    }
}
