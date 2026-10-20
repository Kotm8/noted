package com.noted.wear.connection

import android.os.Build
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.noted.wear.data.WatchHttp
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import com.noted.wear.notifications.WatchSyncWorker
import org.json.JSONObject

class PairingService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != "/noted/watch/pair" || event.data.size > 4096) return
        val result = runCatching {
            val data = JSONObject(String(event.data, Charsets.UTF_8))
            val origin = WatchHttp.origin(data.getString("origin"))
            val ticket = data.getString("ticket")
            require(ticket.length in 43..128)
            val credentials =
                WatchHttp.request(
                    origin,
                    "/api/v1/wear/connect",
                    "POST",
                    JSONObject().put("ticket", ticket).put("name", Build.MODEL),
                )
            require(credentials.getString("origin") == origin)
            WatchStore(this).saveCredentials(credentials)
            WatchSyncWorker.schedule(this)
            runCatching { WatchRepository(this).refresh() }
        }
        val response =
            JSONObject()
                .put("paired", result.isSuccess)
                .put("origin", WatchStore(this).credentials()?.optString("origin"))
                .put("message", result.exceptionOrNull()?.message ?: "Watch paired.")
        Wearable.getMessageClient(this)
            .sendMessage(
                event.sourceNodeId,
                "/noted/watch/paired",
                response.toString().toByteArray(Charsets.UTF_8),
            )
        sendBroadcast(android.content.Intent("com.noted.wear.REFRESH").setPackage(packageName))
    }
}
