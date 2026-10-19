package com.noted.android.notifications

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.TimeUnit
import org.json.JSONObject

object FirebaseRuntime {
    @Synchronized
    fun initialize(context: Context, client: JSONObject): FirebaseApp {
        require(client.getString("package_name") == context.packageName) {
            "Firebase is configured for a different Android app."
        }
        val options =
            FirebaseOptions.Builder()
                .setProjectId(client.getString("project_id"))
                .setApplicationId(client.getString("application_id"))
                .setGcmSenderId(client.getString("sender_id"))
                .setApiKey(client.getString("api_key"))
                .build()
        val existing =
            FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        if (existing?.options == options) return existing
        existing?.delete()
        return FirebaseApp.initializeApp(context, options).apply {
            setDataCollectionDefaultEnabled(false)
        }
    }

    fun restore(context: Context) {
        val saved = PushState(context).read() ?: return
        val client = saved.optJSONObject("client") ?: return
        runCatching { initialize(context, client) }
    }

    fun token(): String = Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
}
