package com.noted.android.notifications

import android.content.Context
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
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
                body = JSONObject().put("ticket", ticket),
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
        store.write(state)
        FirebaseRuntime.initialize(context, client)
        val token = FirebaseRuntime.token()
        PushHttp.request(
            origin,
            "/api/v1/notifications/android/complete",
            body = JSONObject().put("ticket", ticket).put("token", token).put("secret", secret),
        )
        store.write(
            state
                .put("secret", secret)
                .put("device_id", prepared.getString("device_id"))
                .put("token", token),
        )
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
    }

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
        PushState(context).clear()
        NotificationManagerCompat.from(context).cancelAll()
        runCatching {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            FirebaseMessaging.getInstance().deleteToken()
        }
    }
}
