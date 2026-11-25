package com.noted.android.pilot

import com.getcapacitor.JSObject
import com.noted.android.data.NativeApi
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

internal class PilotLive(private val emit: (JSObject) -> Unit) {
    private data class Connection(val id: String, val socket: WebSocket)

    private var active: Connection? = null

    @Synchronized
    fun start(id: String, api: NativeApi) {
        stop()
        val request = Request.Builder().url(api.url("/api/v1/live")).build()
        val socket = api.client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length <= 8000) publish(webSocket, JSObject().put("id", id).put("data", text))
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                closed(webSocket, id, code)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val code = if (response?.code in listOf(401, 403)) 1008 else 1006
                response?.close()
                closed(webSocket, id, code)
            }
        })
        active = Connection(id, socket)
    }

    @Synchronized
    fun stop(id: String? = null) {
        val current = active ?: return
        if (id != null && current.id != id) return
        active = null
        current.socket.cancel()
    }

    @Synchronized
    fun reconnect() {
        val current = active ?: return
        stop(current.id)
        emit(JSObject().put("id", current.id).put("code", 1012))
    }

    @Synchronized
    private fun publish(socket: WebSocket, event: JSObject) {
        if (active?.socket === socket) emit(event)
    }

    @Synchronized
    private fun closed(socket: WebSocket, id: String, code: Int) {
        if (active?.socket !== socket) return
        active = null
        emit(JSObject().put("id", id).put("code", code))
    }
}
