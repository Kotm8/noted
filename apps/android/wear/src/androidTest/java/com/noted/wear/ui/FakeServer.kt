package com.noted.wear.ui

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLStreamHandler
import java.net.URLStreamHandlerFactory

/**
 * Answers the watch's HTTPS requests inside the test process. Java allows one
 * URL handler factory per process, so every test shares this one and swaps
 * [respond] instead.
 */
object FakeServer {
    /** Status and body for a request path and method; a negative status drops the connection. */
    @Volatile
    var respond: (path: String, method: String) -> Pair<Int, String> = { _, _ -> 200 to "{}" }

    private var installed = false

    @Synchronized
    fun install() {
        if (installed) return
        installed = true
        URL.setURLStreamHandlerFactory(
            URLStreamHandlerFactory { protocol ->
                if (protocol != "https") null
                else
                    object : URLStreamHandler() {
                        override fun openConnection(url: URL): HttpURLConnection {
                            check(url.host == "noted-watch.test")
                            return object : HttpURLConnection(url) {
                                private val request = ByteArrayOutputStream()
                                private val response by lazy { respond(url.path, method) }

                                override fun connect() = Unit

                                override fun disconnect() = Unit

                                override fun usingProxy() = false

                                override fun getOutputStream() = request

                                override fun getResponseCode() =
                                    if (response.first < 0) throw IOException("Network unreachable")
                                    else response.first

                                override fun getInputStream() =
                                    if (response.first >= 400)
                                        throw IOException("HTTP ${response.first}")
                                    else ByteArrayInputStream(response.second.toByteArray())

                                override fun getErrorStream() =
                                    ByteArrayInputStream(response.second.toByteArray())
                            }
                        }
                    }
            },
        )
    }
}
