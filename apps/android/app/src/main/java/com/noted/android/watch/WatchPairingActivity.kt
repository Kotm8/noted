package com.noted.android.watch

import android.app.AlertDialog
import android.os.Bundle
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.noted.android.connection.AppAssociation
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ServerAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class WatchPairingActivity : ComponentActivity(), MessageClient.OnMessageReceivedListener {
    private val network = Executors.newSingleThreadExecutor()
    private var selectedNode = ""
    private var selectedOrigin = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(ProgressBar(this))
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
                AppAssociation.verify(this, origin)
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
                        AlertDialog.Builder(this)
                            .setTitle("Pair Noted watch")
                            .setItems(nodes.map { it.displayName }.toTypedArray()) { _, index ->
                                selectedNode = nodes[index].id
                                selectedOrigin = origin
                                val payload =
                                    JSONObject()
                                        .put("origin", origin)
                                        .put("ticket", ticket)
                                        .toString()
                                        .toByteArray(Charsets.UTF_8)
                                Wearable.getMessageClient(this)
                                    .sendMessage(nodes[index].id, "/noted/watch/pair", payload)
                                    .addOnSuccessListener {
                                        android.os
                                            .Handler(mainLooper)
                                            .postDelayed(
                                                {
                                                    if (!isFinishing && selectedNode.isNotEmpty())
                                                        fail(
                                                            "Pairing is still running. Check Noted on the watch; if it is not connected, pair again."
                                                        )
                                                },
                                                45000,
                                            )
                                    }
                                    .addOnFailureListener {
                                        fail(
                                            "Pairing could not reach the watch. Install the matching Noted watch APK and retry."
                                        )
                                    }
                            }
                            .setNegativeButton("Cancel") { _, _ -> finish() }
                            .setOnCancelListener { finish() }
                            .show()
                    }
            }
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
        AlertDialog.Builder(this)
            .setTitle("Noted watch")
            .setMessage(message)
            .setPositiveButton("Done") { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }

    override fun onDestroy() {
        Wearable.getMessageClient(this).removeListener(this)
        network.shutdownNow()
        super.onDestroy()
    }
}
