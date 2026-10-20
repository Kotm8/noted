package com.noted.wear.notifications

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

object WatchPush {
    private val executor = Executors.newSingleThreadExecutor()
    private val registering = AtomicBoolean(false)

    @Synchronized
    fun configure(context: Context, client: JSONObject?) {
        if (client == null) return
        require(client.getString("package_name") == context.packageName)
        val options =
            FirebaseOptions.Builder()
                .setProjectId(client.getString("project_id"))
                .setApplicationId(client.getString("application_id"))
                .setGcmSenderId(client.getString("sender_id"))
                .setApiKey(client.getString("api_key"))
                .build()
        val old =
            FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        if (old?.options != options) {
            old?.delete()
            FirebaseApp.initializeApp(context, options).setDataCollectionDefaultEnabled(false)
        }
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        scheduleRegistration(context)
    }

    fun scheduleRegistration(context: Context) {
        if (!registering.compareAndSet(false, true)) return
        executor.execute {
            try {
                runCatching { register(context.applicationContext) }
            } finally {
                registering.set(false)
            }
        }
    }

    fun restore(context: Context) {
        val client = WatchStore(context).snapshot()?.optJSONObject("firebase") ?: return
        val options =
            FirebaseOptions.Builder()
                .setProjectId(client.getString("project_id"))
                .setApplicationId(client.getString("application_id"))
                .setGcmSenderId(client.getString("sender_id"))
                .setApiKey(client.getString("api_key"))
                .build()
        if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME })
            FirebaseApp.initializeApp(context, options).setDataCollectionDefaultEnabled(false)
    }

    fun register(context: Context) {
        val token = Tasks.await(FirebaseMessaging.getInstance().token, 20, TimeUnit.SECONDS)
        if (WatchStore(context).registeredToken() == token) return
        WatchRepository(context).request("push", JSONObject().put("token", token), "PUT")
        WatchStore(context).saveRegisteredToken(token)
    }
}
