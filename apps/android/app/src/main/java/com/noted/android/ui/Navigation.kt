package com.noted.android.ui

import android.net.Uri
import androidx.compose.runtime.staticCompositionLocalOf
import com.noted.android.data.*

val LocalNotedNavigate = staticCompositionLocalOf<(String) -> Unit> { {} }

fun notedRoute(uri: Uri): String? {
    val segments = uri.pathSegments
    val index = segments.indexOf("c").takeIf { it >= 0 } ?: segments.indexOf("channels").takeIf { it >= 0 }
    if (index != null) return segments.getOrNull(index + 1)?.let { channelRoute(it,
        ChannelLocation(uri.getQueryParameter("message"), uri.getQueryParameter("thread"), uri.getQueryParameter("entry"))) }
    return when (segments.firstOrNull()) { "home" -> "home"; "habits" -> "habits"; "nutrition" -> "nutrition"; "schedule", "calendar" -> "calendar"; else -> null }
}
