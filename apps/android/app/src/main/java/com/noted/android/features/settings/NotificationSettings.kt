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
import com.noted.android.notifications.NotificationSetupActivity
import com.noted.android.notifications.PushState
import com.noted.android.ui.*
import org.json.JSONObject
import java.util.UUID

@Composable
fun NotificationSettings(repository: NativeRepository) {
    val resource = rememberResource(repository, "/notifications/settings")
    val status = rememberResource(repository, "/notifications/android/status")
    val context = LocalContext.current
    val actions = rememberActions()
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var configure by remember { mutableStateOf(false) }
    val value = draft ?: resource.obj
    fun set(key: String, item: Any) { draft = (value ?: JSONObject()).copy().put(key, item) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Notifications", style = MaterialTheme.typography.titleLarge)
        ResourceStatus(resource) { repository.changed() }
        val configured = status.obj?.optBoolean("configured") == true
        if (!configured) {
            Text("Set up Android delivery", style = MaterialTheme.typography.titleMedium)
            Text("Create a Firebase project, add an Android app named com.noted.android, and download google-services.json. In Project settings > Service accounts, generate a private key. Import both files here.")
            NotedTextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://console.firebase.google.com/"))) }) { Text("Open Firebase console") }
            NotedButton(onClick = { configure = true }) { Text("Configure Firebase") }
        } else {
            Text("Firebase: ${status.obj?.text("project_id")}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            NotedButton(enabled = !actions.busy, onClick = { actions.run {
                val preferences = context.getSharedPreferences("native_device", android.content.Context.MODE_PRIVATE)
                val device = preferences.getString("id", null) ?: UUID.randomUUID().toString().also { preferences.edit().putString("id", it).commit() }
                val pairing = JSONObject(repository.mutate("/notifications/android/pairings", body = json("device_id" to device)))
                val origin = repository.session.value!!.origin
                val uri = Uri.Builder().scheme("noted").authority("notifications").path("/connect").appendQueryParameter("origin", origin)
                    .appendQueryParameter("ticket", pairing.text("ticket")).build()
                context.startActivity(Intent(context, NotificationSetupActivity::class.java).setData(uri))
            } }) { Text("Enable notifications on this phone") }
            NotedOutlinedButton(enabled = !actions.busy, onClick = { actions.run { repository.mutate("/notifications/test") } }) { Text("Send test notification") }
            NotedTextButton(onClick = { configure = true }) { Text("Change Firebase configuration") }
        }
        if (value != null) {
            SectionTitle("Delivery preferences")
            Toggle("Notifications enabled", value.optBoolean("enabled", true)) { set("enabled", it) }
            Toggle("Android notifications", value.optBoolean("android_enabled", true)) { set("android_enabled", it) }
            Choice("Default snooze", value.optInt("snooze_minutes", 10), listOf(5, 10, 15, 30, 60).map { it to "$it minutes" }) { set("snooze_minutes", it) }
            Choice("Activity prompt", value.optInt("plan_notice_minutes"), listOf(0 to "At start", 1 to "1 minute before", 5 to "5 minutes before", 10 to "10 minutes before")) { set("plan_notice_minutes", it) }
            Toggle("Quiet hours", value.optBoolean("quiet_hours")) { set("quiet_hours", it) }
            if (value.optBoolean("quiet_hours")) {
                TimeField("Quiet from", value.optInt("quiet_start_minute", 1320)) { set("quiet_start_minute", it) }
                TimeField("Quiet until", value.optInt("quiet_end_minute", 480)) { set("quiet_end_minute", it) }
            }
            NotedButton(enabled = draft != null && !actions.busy, onClick = { actions.run { repository.mutate("/notifications/settings", "PUT", value); draft = null } }, modifier = Modifier.fillMaxWidth()) { Text("Save preferences") }
        }
    }
    if (configure) {
        var services by remember { mutableStateOf("") }
        var account by remember { mutableStateOf("") }
        EditorSheet("Firebase configuration", { configure = false }, enabled = services.isNotBlank() && account.isNotBlank(), save = {
            repository.mutate("/notifications/android/config", "PUT", json("googleServicesJson" to services, "serviceAccountJson" to account))
            services = ""; account = ""
        }) {
            QuietNotice("The private service-account key is sent only to your selected server. It is not cached on this phone.")
            Field("google-services.json", services, { services = it }, singleLine = false)
            Field("Service-account JSON", account, { account = it }, singleLine = false)
        }
    }
}
