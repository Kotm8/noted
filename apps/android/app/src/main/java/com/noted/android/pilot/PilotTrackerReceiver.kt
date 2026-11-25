package com.noted.android.pilot

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.noted.android.features.tracker.TrackerTileService
import com.noted.android.MainActivity
import com.noted.android.data.NativeApi
import com.noted.android.data.SecretStore
import com.noted.android.data.json
import com.noted.android.data.objects
import com.noted.android.features.tracker.TrackerNotification
import com.noted.android.features.tracker.TrackerSnapshot
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject

internal object PilotTracker {
    data class State(val origin: String, val binding: String, val tracker: TrackerSnapshot)

    private fun connection(context: Context): NativeApi? = runCatching {
        val saved = JSONObject(SecretStore(context, "capacitor_pilot").read() ?: return null)
        val origin = saved.getString("origin")
        val values = saved.getJSONArray("cookies")
        NativeApi(origin, (0 until values.length()).mapNotNull {
            Cookie.parse(origin.toHttpUrl(), values.getString(it))
        })
    }.getOrNull()

    fun binding(api: NativeApi): String? =
        binding(api.jar.loadForRequest(api.url("/api/v1/auth/session").toHttpUrl()))

    fun binding(cookies: List<Cookie>): String? {
        val cookie = cookies.firstOrNull { it.name == "noted_session" } ?: return null
        return android.util.Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(cookie.value.toByteArray()),
            android.util.Base64.NO_WRAP,
        )
    }

    suspend fun state(context: Context): State? {
        val api = connection(context) ?: return null
        val binding = binding(api) ?: return null
        val tracker = JSONObject(api.request("/time-tracking/tracker"))
        val activities = if (tracker.optJSONObject("active") != null || !tracker.isNull("paused_activity_id"))
            JSONArray(api.request("/time-tracking/activities")).objects() else emptyList()
        if (connection(context)?.let(::binding) != binding) return null
        return State(api.origin, binding, TrackerSnapshot(tracker, activities))
    }

    suspend fun sync(
        context: Context,
        action: String? = null,
        expected: String? = null,
        revision: Int = 0,
        snapshot: JSONObject? = null,
    ) {
        val api = connection(context) ?: return TrackerNotification.clear(context)
        val current = binding(api) ?: return TrackerNotification.clear(context)
        if (expected != null && current != expected) return
        var tracker = snapshot ?: JSONObject(api.request("/time-tracking/tracker"))
        if (action != null && tracker.optInt("revision") == revision) {
            val result = runCatching {
                api.request("/time-tracking/tracker", "POST", json(
                    "action" to action, "revision" to revision, "request_id" to UUID.randomUUID().toString(),
                ))
            }.getOrNull()
            tracker = JSONObject(result ?: api.request("/time-tracking/tracker"))
        }
        if (tracker.optJSONObject("active") == null && tracker.isNull("paused_activity_id")) {
            if (connection(context)?.let(::binding) == current) {
                TrackerNotification.clear(context)
                TrackerTileService.refresh(context)
            }
            return
        }
        val activities = JSONArray(api.request("/time-tracking/activities")).objects()
        if (connection(context)?.let(::binding) != current) return
        val open = Intent(context, MainActivity::class.java).setData(Uri.parse("${api.origin}/?track=1"))
        TrackerNotification.show(context, TrackerSnapshot(tracker, activities), open) { command ->
            val intent = Intent(context, PilotTrackerReceiver::class.java)
                .setData(Uri.parse("noted://tracker/$command"))
                .putExtra("action", command)
                .putExtra("revision", tracker.optInt("revision"))
                .putExtra("binding", current)
            PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        TrackerTileService.refresh(context)
    }
}

class PilotTrackerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra("action")?.takeIf { it in setOf("pause", "stop", "resume") } ?: return
        val binding = intent.getStringExtra("binding") ?: return
        val revision = intent.getIntExtra("revision", 0).takeIf { it > 0 } ?: return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                PilotTracker.sync(context.applicationContext, action, binding, revision)
            } catch (_: java.io.IOException) {
                kotlinx.coroutines.withContext(Dispatchers.Main) {
                    android.widget.Toast.makeText(context, "Couldn't reach your server.", android.widget.Toast.LENGTH_SHORT).show()
                }
            } finally {
                pending.finish()
            }
        }
    }
}
