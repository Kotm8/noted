package com.noted.android.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import kotlin.math.sin

fun Modifier.ambientChrome(): Modifier = composed {
    val preferences = LocalAppearancePreferences.current
    val profile = preferences?.optString("style", "modern") ?: "modern"
    val accent = NotedStyle.colors.accent
    val reduced = preferences?.optBoolean("reducedMotion") == true || android.provider.Settings.Global.getFloat(androidx.compose.ui.platform.LocalContext.current.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    val phase = if (profile == "modern" || reduced) 0f else {
        val motion = rememberInfiniteTransition(label = "Chrome pattern")
        val position by motion.animateFloat(0f, 1f, infiniteRepeatable(tween(24000, easing = LinearEasing), RepeatMode.Restart), label = "Pattern position")
        position
    }
    drawBehind {
        if (profile == "comic") {
            val step = 16.dp.toPx()
            for (row in -1..(size.height / step).toInt() + 1) for (column in -1..(size.width / step).toInt() + 1) {
                val radius = (1.2f + sin(column * .45f + row * .35f - phase * 6.283f).toFloat()) * 1.4.dp.toPx()
                drawCircle(accent.copy(alpha = .09f), radius.coerceAtLeast(.15f), Offset(column * step + phase * step, row * step + phase * step))
            }
        } else if (profile == "snow" || profile == "stars") {
            for (index in 0..23) {
                val x = ((index * .618034f + phase * .07f) % 1f) * size.width
                val y = ((index * .381966f + if (profile == "snow") phase else 0f) % 1f) * size.height
                val alpha = if (profile == "stars") .08f + .07f * sin((index + phase * 6.283f).toDouble()).toFloat() else .14f
                drawCircle(accent.copy(alpha = alpha), ((index % 3 + 1) * .65f).dp.toPx(), Offset(x, y))
            }
        }
    }
}
