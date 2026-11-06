package com.noted.android.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.Density
import org.json.JSONObject

fun color(value: String, fallback: Color = Color(0xFFE2C15A)): Color =
    runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(fallback)

data class NotedPalette(
    val main: Color = Color(0xFF1F1F1F),
    val sidebar: Color = Color(0xFF181818),
    val header: Color = Color(0xFF181818),
    val rail: Color = Color(0xFF181818),
    val input: Color = Color(0xFF313131),
    val floating: Color = Color(0xFF222222),
    val hover: Color = Color(0xFF2A2D2E),
    val selected: Color = Color(0xFF37373D),
    val text: Color = Color(0xFFCCCCCC),
    val secondary: Color = Color(0xFFB5B5B5),
    val muted: Color = Color(0xFFA3A3A3),
    val faint: Color = Color(0xFF939393),
    val code: Color = Color(0xFF181818),
    val link: Color = Color(0xFFE2C15A),
    val border: Color = Color(0xFF3C3C3C),
    val subtle: Color = Color(0xFF2B2B2B),
    val accent: Color = Color(0xFFE2C15A),
    val accentText: Color = Color(0xFF201E1A),
    val danger: Color = Color(0xFFDF9D96),
    val success: Color = Color(0xFF9FC28A),
)

private val LocalNotedPalette = staticCompositionLocalOf { NotedPalette() }
object NotedStyle {
    val colors: NotedPalette
        @Composable get() = LocalNotedPalette.current
}

val NotedPalette.successSurface: Color get() = lerp(floating, success, .16f)
val NotedPalette.accentSurface: Color get() = lerp(floating, accent, .08f)

fun appearancePalette(appearance: JSONObject?): NotedPalette {
    val defaults = NotedPalette()
    val background = color(appearance?.optString("background").orEmpty(), defaults.main)
    val sidebar = color(appearance?.optString("sidebar").orEmpty(), defaults.sidebar)
    val text = color(appearance?.optString("text").orEmpty(), defaults.text)
    val accent = color(appearance?.optString("accent").orEmpty(), defaults.accent)
    val custom = background != defaults.main || sidebar != defaults.sidebar || text != defaults.text
    return defaults.copy(main = background, sidebar = sidebar, text = text, accent = accent,
        header = if (custom) lerp(background, sidebar, .35f) else defaults.header,
        rail = if (custom) lerp(background, Color.Black, .28f) else defaults.rail,
        input = if (custom) lerp(background, text, .07f) else defaults.input,
        floating = if (custom) lerp(sidebar, text, .04f) else defaults.floating,
        hover = if (custom) lerp(sidebar, text, .06f) else defaults.hover,
        selected = if (custom) lerp(sidebar, text, .11f) else defaults.selected,
        secondary = if (custom) lerp(background, text, .77f) else defaults.secondary,
        muted = if (custom) lerp(background, text, .66f) else defaults.muted,
        faint = if (custom) lerp(background, text, .56f) else defaults.faint,
        code = if (custom) lerp(background, Color.Black, .19f) else defaults.code,
        link = lerp(accent, text, .12f),
        subtle = if (custom) lerp(background, text, .10f) else defaults.subtle,
        border = if (custom) lerp(background, text, .20f) else defaults.border,
        accentText = if (accent.luminance() > .35f) Color(0xFF201E1A) else Color(0xFFF4F4EF))
}

@Composable
fun NotedTheme(appearance: JSONObject? = null, content: @Composable () -> Unit) {
    val palette = appearancePalette(appearance)
    val background = palette.main
    val sidebar = palette.sidebar
    val text = palette.text
    val accent = palette.accent
    val scale = (appearance?.optDouble("textSize", 15.0) ?: 15.0).toFloat().coerceIn(12f, 20f) / 15f
    val density = LocalDensity.current
    val zoom = (appearance?.optDouble("zoom", 100.0) ?: 100.0).toFloat().coerceIn(75f, 150f) / 100f
    val view = LocalView.current
    SideEffect {
        var context = view.context
        while (context is android.content.ContextWrapper && context !is android.app.Activity) context = context.baseContext
        (context as? android.app.Activity)?.let { activity ->
            androidx.core.view.WindowCompat.getInsetsController(activity.window, view).apply {
                isAppearanceLightStatusBars = palette.header.luminance() > .5f
                isAppearanceLightNavigationBars = palette.main.luminance() > .5f
            }
        }
    }
    fun style(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontFamily = FontFamily.SansSerif, fontSize = (size * scale).sp, lineHeight = (size * scale * 1.45f).sp,
        fontWeight = weight, letterSpacing = 0.sp)
    val type = Typography(
        displayLarge = style(28), displayMedium = style(26), displaySmall = style(24),
        headlineLarge = style(24, FontWeight.SemiBold), headlineMedium = style(22, FontWeight.SemiBold), headlineSmall = style(20, FontWeight.SemiBold),
        titleLarge = style(18, FontWeight.SemiBold), titleMedium = style(15, FontWeight.SemiBold), titleSmall = style(14, FontWeight.Medium),
        bodyLarge = style(15), bodyMedium = style(14), bodySmall = style(12),
        labelLarge = style(13, FontWeight.Medium), labelMedium = style(12), labelSmall = style(11))
    CompositionLocalProvider(LocalNotedPalette provides palette,
        LocalDensity provides Density(density.density * zoom, density.fontScale)) {
        MaterialTheme(colorScheme = darkColorScheme(
            primary = accent, onPrimary = palette.accentText, primaryContainer = palette.selected, onPrimaryContainer = text,
            secondary = accent, onSecondary = palette.accentText, secondaryContainer = palette.selected, onSecondaryContainer = text,
            tertiary = accent, onTertiary = palette.accentText, tertiaryContainer = palette.selected, onTertiaryContainer = text,
            background = background, onBackground = text, surface = background, onSurface = text,
            surfaceVariant = sidebar, onSurfaceVariant = palette.secondary, surfaceTint = Color.Transparent,
            surfaceContainerLowest = sidebar, surfaceContainerLow = sidebar, surfaceContainer = palette.floating,
            surfaceContainerHigh = palette.floating, surfaceContainerHighest = palette.selected,
            outline = palette.border, outlineVariant = palette.subtle, error = palette.danger),
            shapes = Shapes(extraSmall = RoundedCornerShape(3.dp), small = RoundedCornerShape(4.dp),
                medium = RoundedCornerShape(6.dp), large = RoundedCornerShape(8.dp), extraLarge = RoundedCornerShape(8.dp)),
            typography = type, content = content)
    }
}
