package com.noted.android.pilot

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

internal class PilotWatchPairing(private val context: Context) {
    fun devices() = Tasks.await(Wearable.getNodeClient(context).connectedNodes, 10, TimeUnit.SECONDS)

    suspend fun pair(node: String, origin: String, ticket: String) {
        val messages = Wearable.getMessageClient(context)
        val result = CompletableDeferred<JSONObject>()
        val listener = MessageClient.OnMessageReceivedListener { event ->
            if (event.sourceNodeId == node && event.path == "/noted/watch/paired" && event.data.size <= 4096) {
                val data = runCatching { JSONObject(event.data.toString(Charsets.UTF_8)) }.getOrNull()
                if (data != null && (!data.optBoolean("paired") || data.optString("origin") == origin))
                    result.complete(data)
            }
        }
        Tasks.await(messages.addListener(listener), 10, TimeUnit.SECONDS)
        try {
            val data = JSONObject().put("origin", origin).put("ticket", ticket)
            Tasks.await(messages.sendMessage(node, "/noted/watch/pair", data.toString().toByteArray()), 10, TimeUnit.SECONDS)
            val reply = withTimeout(45000) { result.await() }
            check(reply.optBoolean("paired")) { reply.optString("message", "Couldn't pair the watch.").take(250) }
        } finally {
            messages.removeListener(listener)
        }
    }
}
