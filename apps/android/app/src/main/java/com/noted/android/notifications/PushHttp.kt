package com.noted.android.notifications

import com.noted.android.connection.ServerAddress
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONObject

class PushHttpException(val status: Int, message: String) : Exception(message)

object PushHttp {
    fun request(
        origin: String,
        path: String,
        method: String = "POST",
        body: JSONObject? = null,
        secret: String? = null,
    ): JSONObject {
        require(
            ServerAddress.normalize(origin) == origin &&
                path.startsWith("/api/v1/notifications/android/"),
        )
        val connection = URI(origin + path).toURL().openConnection() as HttpURLConnection
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
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw =
                stream
                    ?.use {
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(4096)
                        while (true) {
                            val count = it.read(buffer)
                            if (count < 0) break
                            require(output.size() + count <= 65536) {
                                "The server returned too much data."
                            }
                            output.write(buffer, 0, count)
                        }
                        output.toString(Charsets.UTF_8.name())
                    }
                    .orEmpty()
            if (status !in 200..299) {
                val detail = runCatching { JSONObject(raw).opt("detail") as? String }.getOrNull()
                throw PushHttpException(
                    status,
                    detail ?: "The server could not complete this notification request ($status).",
                )
            }
            return if (raw.isBlank()) JSONObject() else JSONObject(raw)
        } finally {
            connection.disconnect()
        }
    }
}
