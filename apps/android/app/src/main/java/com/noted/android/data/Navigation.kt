package com.noted.android.data

import android.net.Uri
import org.json.JSONObject

data class ChannelLocation(val message: String? = null, val thread: String? = null, val entry: String? = null)

fun channelId(route: String): String? = route.takeIf { it.startsWith("channel/") }?.substringAfter('/')?.substringBefore('?')

fun channelLocation(route: String): ChannelLocation {
    val uri = Uri.parse(route)
    return ChannelLocation(uri.getQueryParameter("message"), uri.getQueryParameter("thread"), uri.getQueryParameter("entry"))
}

fun channelRoute(id: String, location: ChannelLocation = ChannelLocation()): String = Uri.parse("channel/$id").buildUpon().apply {
    location.message?.let { appendQueryParameter("message", it) }
    location.thread?.let { appendQueryParameter("thread", it) }
    location.entry?.let { appendQueryParameter("entry", it) }
}.build().toString()

fun searchRoute(result: JSONObject): String = channelRoute(result.text("channel_id"), when (result.text("kind")) {
    "journal" -> ChannelLocation(entry = result.text("id"))
    "document" -> ChannelLocation()
    else -> ChannelLocation(message = result.text("id"), thread = result.text("thread_root_id").takeIf { it.isNotBlank() })
})
