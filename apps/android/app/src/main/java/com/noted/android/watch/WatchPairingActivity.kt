package com.noted.android.watch

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.material3.Text
import com.google.android.gms.wearable.Node
import com.noted.android.NotedApplication
import com.noted.android.ui.*
import androidx.activity.ComponentActivity
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ServerAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class WatchPairingActivity : ComponentActivity(), MessageClient.OnMessageReceivedListener {
    private val network = Executors.newSingleThreadExecutor()
    private var selectedNode = ""
    private var selectedOrigin = ""
    private var devices by mutableStateOf(emptyList<Node>())
    private var resultMessage by mutableStateOf<String?>(null)
    private var connecting by mutableStateOf(false)
    private var pairTicket = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AccountTheme((application as NotedApplication).repository) {
                ConnectionScreen("Noted watch", resultMessage ?: if (connecting) "Connecting to your watch." else "Choose a connected watch.",
                    busy = resultMessage == null && (devices.isEmpty() || connecting)) {
                    if (resultMessage != null) NotedButton({ finish() }) { Text("Done") }
                    else if (!connecting) devices.forEach { node ->
                        NotedOutlinedButton({ connect(node) }) { Text(node.displayName) }
                    }
                    if (resultMessage == null) NotedTextButton({ finish() }) { Text("Cancel") }
                }
            }
        }
        Wearable.getMessageClient(this).addListener(this)
        val origin = intent.data?.getQueryParameter("origin")
        val ticket = intent.data?.getQueryParameter("ticket")
        if (
            intent.data?.host != "watch" ||
                intent.data?.path != "/connect" ||
                origin == null ||
                ticket == null ||
                ticket.length !in 43..128 ||
                ConnectionStore(this).origin != origin ||
                runCatching { ServerAddress.normalize(origin) != origin }.getOrDefault(true)
        ) {
            fail("Open Settings > Watch from your signed-in Noted server to pair.")
            return
        }
        network.execute {
            val result = runCatching {
                Tasks.await(Wearable.getNodeClient(this).connectedNodes, 15, TimeUnit.SECONDS)
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                result
                    .onFailure {
                        fail("Could not find your watch. Check the Bluetooth connection.")
                    }
                    .onSuccess { nodes ->
                        if (nodes.isEmpty()) {
                            fail(
                                "Connect your watch to this phone, install the Noted watch APK, and try again."
                            )
                            return@onSuccess
                        }
                        selectedOrigin = origin
                        pairTicket = ticket
                        devices = nodes
                    }
            }
        }
    }

    private fun connect(node: Node) {
        selectedNode = node.id
        connecting = true
        val payload = JSONObject().put("origin", selectedOrigin).put("ticket", pairTicket).toString().toByteArray(Charsets.UTF_8)
        Wearable.getMessageClient(this).sendMessage(node.id, "/noted/watch/pair", payload)
            .addOnSuccessListener {
                android.os.Handler(mainLooper).postDelayed({
                    if (!isFinishing && !isDestroyed && selectedNode.isNotEmpty()) {
                        fail("Pairing is still running. Check Noted on the watch; if it is not connected, pair again.")
                    }
                }, 45000)
            }.addOnFailureListener {
                fail("Pairing could not reach the watch. Install the matching Noted watch APK and retry.")
            }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (
            event.path != "/noted/watch/paired" ||
                event.sourceNodeId != selectedNode ||
                event.data.size > 4096
        )
            return
        val data =
            runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: return
        runOnUiThread {
            if (data.optBoolean("paired") && data.optString("origin") == selectedOrigin) {
                WatchConnection.save(this, selectedOrigin, selectedNode)
                selectedNode = ""
                fail(
                    "Watch connected. Open Noted on the watch to switch activities and handle reminders."
                )
            } else fail(data.optString("message", "Could not pair the watch. Try again."))
        }
    }

    private fun fail(message: String) {
        if (isFinishing || isDestroyed) return
        connecting = false
        resultMessage = message
    }

    override fun onDestroy() {
        Wearable.getMessageClient(this).removeListener(this)
        network.shutdownNow()
        super.onDestroy()
    }
}
