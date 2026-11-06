package com.noted.android.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

class LiveConnection(private val repository: NativeRepository, private val scope: CoroutineScope) {
    private var socket: WebSocket? = null
    private var reconnect: Job? = null
    private var fallback: Job? = null
    private var running = false
    private var connected = false
    private var failures = 0

    fun start() {
        if (running) return
        running = true
        connect()
        fallback = scope.launch {
            while (running) {
                delay(if (connected) 120_000 else 20_000)
                repository.changed(); repository.flush()
            }
        }
    }

    private fun connect() {
        if (!running || repository.session.value == null) return
        val api = repository.api
        val request = Request.Builder().url(api.origin + "/api/v1/live").header("Origin", api.origin).build()
        socket = api.client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connected = true; failures = 0; repository.changed()
                scope.launch { repository.flush() }
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length > 65536) return
                val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (message.has("topic")) repository.changed(message.optString("topic"))
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { retry() }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                response?.close(); retry()
            }
        })
    }

    @Synchronized
    private fun retry() {
        connected = false
        if (!running || reconnect?.isActive == true) return
        reconnect = scope.launch {
            delay((1000L shl failures.coerceAtMost(5)).also { failures++ })
            reconnect = null
            connect()
        }
    }

    fun stop() {
        running = false; connected = false; reconnect?.cancel(); fallback?.cancel()
        socket?.cancel(); socket = null
    }
}
