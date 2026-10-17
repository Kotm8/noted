package com.noted.android.connection

import java.net.URI

object ServerAddress {
    fun normalize(input: String): String {
        val text = input.trim()
        val uri = URI(if (text.contains("://")) text else "https://$text")
        require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Enter your server's HTTPS domain." }
        require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) { "Enter a domain without credentials or a link path." }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "Enter just the server domain." }
        require(uri.port == -1 || uri.port in 1..65535) { "Invalid server port." }
        val port = if (uri.port == 443) -1 else uri.port
        return URI("https", null, uri.host.lowercase(), port, null, null, null).toString()
    }

    fun owns(origin: String, destination: String): Boolean = runCatching {
        val expected = URI(origin)
        val actual = URI(destination)
        actual.scheme == "https" && actual.rawUserInfo == null &&
            actual.host.equals(expected.host, ignoreCase = true) &&
            effectivePort(actual) == effectivePort(expected)
    }.getOrDefault(false)

    private fun effectivePort(uri: URI) = if (uri.port == -1) 443 else uri.port
}
