package com.noted.wear.data

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONObject

class WatchHttpException(val status: Int, message: String) : Exception(message)

object WatchHttp {
    fun origin(value: String): String {
        val uri = URI(value)
        require(
            uri.scheme == "https" &&
                !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null &&
                uri.rawQuery == null &&
                uri.rawFragment == null &&
                uri.path.isNullOrEmpty()
        ) {
            "Use your server's HTTPS origin."
        }
        return value
    }

    fun request(
        origin: String,
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        secret: String? = null,
    ): JSONObject {
        require(path.startsWith("/api/v1/wear/") && !path.contains("..") && !path.contains('#'))
        val connection = URI(origin(origin) + path).toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 8000
        connection.readTimeout = 15000
        connection.requestMethod = method
        connection.setRequestProperty("Origin", origin)
        connection.setRequestProperty("Accept", "application/json")
        secret?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
        try {
            body?.let {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { stream ->
                    stream.write(it.toString().toByteArray(Charsets.UTF_8))
                }
            }
            val status = connection.responseCode
            val input = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes =
                input?.use { stream ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 1048576) {
                            "Server response is too large."
                        }
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                } ?: ByteArray(0)
            val raw = String(bytes, Charsets.UTF_8)
            if (status !in 200..299)
                throw WatchHttpException(
                    status,
                    runCatching { JSONObject(raw).optString("detail") }
                        .getOrDefault("")
                        .ifBlank { "Could not contact Noted ($status)." },
                )
            return if (raw.isBlank()) JSONObject() else JSONObject(raw)
        } finally {
            connection.disconnect()
        }
    }
}
