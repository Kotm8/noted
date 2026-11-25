package com.noted.android.notifications

import android.content.Context
import android.util.Base64
import com.google.firebase.messaging.FirebaseMessaging
import com.noted.android.data.NativeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.SecureRandom
import java.util.UUID
import org.json.JSONObject

object PushRegistration {
    @Synchronized
    fun pair(context: Context, origin: String, ticket: String) {
        val store = PushState(context)
        val prepared =
            PushHttp.request(
                origin,
                "/api/v1/notifications/android/prepare",
                body = JSONObject().put("ticket", ticket).put("package_name", context.packageName),
            )
        val client = prepared.getJSONObject("client")
        val previous = store.read()
        if (previous != null && previous.optString("origin") != origin) disconnect(context)
        val secret =
            Base64.encodeToString(
                ByteArray(32).also { SecureRandom().nextBytes(it) },
                Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
            )
        val state =
            JSONObject()
                .put("origin", origin)
                .put("client", client)
                .put("binding", UUID.randomUUID().toString())
        val token = try {
            FirebaseRuntime.initialize(context, client)
            val value = FirebaseRuntime.token()
            PushHttp.request(
                origin,
                "/api/v1/notifications/android/complete",
                body = JSONObject().put("ticket", ticket).put("token", value)
                    .put("secret", secret).put("package_name", context.packageName),
            )
            value
        } catch (error: Exception) {
            FirebaseRuntime.restore(context)
            throw error
        }
        store.write(
            state
                .put("secret", secret)
                .put("device_id", prepared.getString("device_id"))
                .put("token", token),
        )
        options(context).edit().putBoolean("push_enabled", true).apply()
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
    }

    @Synchronized
    fun deviceId(context: Context): String {
        val preferences = options(context)
        return preferences.getString("id", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("id", it).apply()
        }
    }

    fun wasEnabled(context: Context): Boolean =
        options(context).getBoolean("push_enabled", false) ||
            PushState(context).read()?.optString("secret")?.isNotBlank() == true

    fun disable(context: Context) {
        disconnect(context)
        options(context).edit().putBoolean("push_enabled", false).apply()
    }

    suspend fun enable(context: Context, api: NativeApi) = withContext(Dispatchers.IO) {
        val ticket = JSONObject(api.request("/notifications/android/pairings", "POST",
            JSONObject().put("device_id", deviceId(context)))).getString("ticket")
        pair(context, api.origin, ticket)
    }

    private fun options(context: Context) =
        context.getSharedPreferences("native_device", Context.MODE_PRIVATE)

    fun refresh(context: Context, token: String, binding: String) {
        val state = PushState(context).read() ?: return
        if (state.optString("binding") != binding) return
        val secret = state.optString("secret").takeIf { it.isNotBlank() } ?: return
        PushHttp.request(
            state.getString("origin"),
            "/api/v1/notifications/android/token",
            "PUT",
            JSONObject().put("token", token),
            secret,
        )
        PushState(context).updateToken(secret, token)
    }

    fun disconnect(context: Context) {
        val store = PushState(context)
        val state = store.read()
        forget(context)
        runCatching {
            if (state != null && state.optString("secret").isNotBlank())
                PushHttp.request(
                    state.getString("origin"),
                    "/api/v1/notifications/android/device",
                    "DELETE",
                    secret = state.getString("secret"),
                )
        }
    }

    fun forget(context: Context) {
        if (wasEnabled(context)) options(context).edit().putBoolean("push_enabled", true).apply()
        val store = PushState(context)
        val origin = store.read()?.optString("origin")
        store.clear()
        if (origin != null) PushNotifications.clear(context, origin)
        runCatching {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            FirebaseMessaging.getInstance().deleteToken()
        }
    }
}
