package com.noted.android.pilot

import android.content.Context
import com.getcapacitor.JSObject
import com.noted.android.data.LocalStore
import com.noted.android.data.SecretStore
import java.util.UUID
import org.json.JSONObject

internal class PilotOffline(context: Context) {
    private data class Identity(val origin: String, val binding: String, val user: String, val owner: UUID) {
        val partition get() = "$origin#$owner"
    }

    private val store = LocalStore(context, "noted-pilot.db")
    private val identity = SecretStore(context, "noted_pilot_verified_owner")
    private var current = identity.read()?.let { runCatching { decode(JSONObject(it)) }.getOrNull() }

    @Synchronized
    fun verify(origin: String, binding: String, response: String) {
        val verified = decode(JSONObject().put("origin", origin).put("binding", binding).put("user", response))
        if (verified == current) return
        current = null
        identity.write(JSONObject().put("origin", origin).put("binding", binding).put("user", response).toString())
        current = verified
    }

    @Synchronized
    fun lock(discard: Boolean) {
        val account = current
        current = null
        identity.clear()
        if (discard && account != null) store.clear(account.partition)
    }

    @Synchronized
    fun save(origin: String, binding: String?, path: String, body: String) {
        val account = authorized(origin, binding) ?: return
        if (cacheable(path) && body.length <= 2 * 1024 * 1024) store.save(account.partition, key(path), body)
    }

    @Synchronized
    fun response(origin: String, binding: String?, path: String): JSObject? {
        val account = authorized(origin, binding) ?: return null
        val result = JSObject().put("offline", true)
        if (path == "/auth/session") return result.put("status", 200).put("body", account.user)
        if (cacheable(path)) {
            val row = store.recent(account.partition, key(path), System.currentTimeMillis() - MAX_AGE)
            if (row != null) return result.put("status", 200).put("body", row.second).put("cachedAt", row.first)
        }
        val detail = if (cacheable(path)) "This view hasn't been loaded on this phone. Reconnect to open it."
            else "Reconnect to use this feature."
        return result.put("status", 503).put("body", JSONObject().put("detail", detail).toString())
    }

    @Synchronized
    fun mediaKey(origin: String, binding: String, path: String): String? =
        authorized(origin, binding)?.let { "${it.partition}#$path" }

    @Synchronized
    fun owner(origin: String, binding: String): UUID? = authorized(origin, binding)?.owner

    private fun authorized(origin: String, binding: String?) =
        current?.takeIf { binding != null && it.origin == origin && it.binding == binding }

    private fun key(path: String) = path.removeSuffix("?")

    companion object {
        private const val MAX_AGE = 30L * 24 * 60 * 60 * 1000
        private val FEATURES = setOf(
            "workspaces", "categories", "channels", "messages", "journal",
            "home", "time-tracking", "schedule", "habits", "nutrition", "finance",
            "reminders", "document-reminders", "templates",
        )

        fun cacheable(path: String): Boolean =
            path == "/settings/appearance" ||
                path.substringBefore('?').substringAfter('/').substringBefore('/') in FEATURES

        private fun decode(value: JSONObject): Identity {
            val raw = value.getString("user")
            require(raw.length <= 4096)
            return Identity(value.getString("origin"), value.getString("binding"), raw,
                UUID.fromString(JSONObject(raw).getString("id")))
        }
    }
}
