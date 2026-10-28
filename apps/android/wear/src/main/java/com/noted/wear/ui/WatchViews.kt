package com.noted.wear.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

val MUTED = Color.rgb(153, 156, 153)
val SECONDARY = Color.rgb(163, 166, 163)
val DANGER = Color.rgb(223, 157, 150)
val SUCCESS = Color.rgb(159, 194, 138)

/** The A01 building blocks every screen is made of. */
class WatchViews(
    private val context: Context,
    val content: LinearLayout,
    val accent: Int,
    val scale: Float,
    /** The visible height, so centred screens sit in the middle of the round display. */
    private val viewport: Int,
    private val busy: () -> Boolean,
) {
    private var centered = false

    /** Centres everything added after this, vertically and horizontally. */
    fun center() {
        centered = true
        content.gravity = Gravity.CENTER
        content.minimumHeight = viewport
    }

    /** Centres the text added after this horizontally, until switched off again. */
    fun centerText(on: Boolean) {
        centered = on
    }

    fun ring(success: Boolean, color: Int) =
        content.addView(
            StatusRing(context, success, color),
            LinearLayout.LayoutParams(dp(54), dp(54)).apply { bottomMargin = dp(8) },
        )

    fun spinner() =
        content.addView(
            ProgressBar(context).apply {
                isIndeterminate = true
                indeterminateTintList = ColorStateList.valueOf(accent)
            },
            LinearLayout.LayoutParams(dp(34), dp(34)).apply { bottomMargin = dp(8) },
        )

    fun label(value: String) = text(value, 9f, MUTED)

    fun text(value: String, size: Float, color: Int = Color.WHITE): TextView =
        TextView(context).apply {
            text = value
            textSize = size * scale
            includeFontPadding = false
            setTextColor(color)
            setPadding(dp(7), dp(3), dp(7), dp(4))
            if (centered) gravity = Gravity.CENTER_HORIZONTAL
            content.addView(this, LinearLayout.LayoutParams(-1, -2))
        }

    fun divider() {
        content.addView(
            View(context).apply { setBackgroundColor(Color.rgb(43, 46, 44)) },
            LinearLayout.LayoutParams(-1, dp(1)).apply {
                topMargin = dp(5)
                bottomMargin = dp(6)
            },
        )
    }

    fun add(view: View) = content.addView(view)

    fun button(
        title: String,
        icon: String = "",
        primary: Boolean = false,
        subtitle: String = "",
        enabled: Boolean = true,
        action: () -> Unit,
    ): LinearLayout {
        val row =
            LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(if (primary) 38 else if (subtitle.isEmpty()) 40 else 46)
                setPadding(dp(7), dp(5), dp(7), dp(5))
                alpha = if (enabled) 1f else .55f
                background =
                    RippleDrawable(
                        ColorStateList.valueOf(0x26FFFFFF),
                        GradientDrawable().apply {
                            cornerRadius = dp(if (primary) 24 else 8).toFloat()
                            setColor(if (primary) accent else Color.TRANSPARENT)
                        },
                        GradientDrawable().apply {
                            cornerRadius = dp(24).toFloat()
                            setColor(Color.WHITE)
                        },
                    )
                isClickable = enabled
                isFocusable = enabled
                contentDescription =
                    listOf(title, subtitle).filter { it.isNotBlank() }.joinToString(", ")
                setOnClickListener {
                    if (!busy()) {
                        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        action()
                    }
                }
            }
        if (icon.isNotEmpty())
            row.addView(
                ImageView(context).apply {
                    setImageDrawable(WatchIcon(icon, if (primary) Color.BLACK else accent))
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                },
                LinearLayout.LayoutParams(dp(17), dp(17)).apply { marginEnd = dp(7) },
            )
        val column = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        column.addView(
            TextView(context).apply {
                text = title
                textSize = (if (primary) 13f else 14f) * scale
                includeFontPadding = false
                setTextColor(if (primary) Color.BLACK else Color.WHITE)
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
                if (primary) {
                    gravity = Gravity.CENTER
                    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                }
            },
        )
        if (subtitle.isNotEmpty())
            column.addView(
                TextView(context).apply {
                    tag = "subtitle"
                    text = subtitle
                    textSize = 11f * scale
                    includeFontPadding = false
                    setPadding(0, dp(3), 0, 0)
                    setTextColor(SECONDARY)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                },
            )
        row.addView(column, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(
            row,
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(if (primary) 6 else 1) },
        )
        return row
    }

    fun icon(name: String, color: Int, size: Int = 26) =
        content.addView(
            ImageView(context).apply {
                setImageDrawable(WatchIcon(name, color))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            },
            LinearLayout.LayoutParams(dp(size), dp(size)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(2)
            },
        )

    /** B01's control row: a pill for the main action, with an optional round button beside it. */
    fun pillRow(
        title: String,
        icon: String,
        onPill: () -> Unit,
        round: Pair<String, String>? = null,
        onRound: () -> Unit = {},
    ) {
        val row =
            LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
        fun control(view: View, action: () -> Unit) =
            view.apply {
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    if (!busy()) {
                        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        action()
                    }
                }
            }
        val pill =
            LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                setPadding(dp(16), 0, dp(18), 0)
                background = shape(accent, 24)
                contentDescription = title
                addView(
                    ImageView(context).apply { setImageDrawable(WatchIcon(icon, Color.BLACK)) },
                    LinearLayout.LayoutParams(dp(15), dp(15)).apply { marginEnd = dp(6) },
                )
                addView(
                    TextView(context).apply {
                        text = title
                        textSize = 13f * scale
                        setTextColor(Color.BLACK)
                        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                    },
                )
            }
        row.addView(control(pill) { onPill() }, LinearLayout.LayoutParams(-2, dp(38)))
        if (round != null) {
            val (name, label) = round
            val button =
                ImageView(context).apply {
                    setImageDrawable(WatchIcon(name, Color.rgb(231, 235, 226)))
                    setPadding(dp(11), dp(11), dp(11), dp(11))
                    background = shape(Color.rgb(32, 36, 31), 19)
                    contentDescription = label
                }
            row.addView(
                control(button) { onRound() },
                LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginStart = dp(8) },
            )
        }
        content.addView(
            row,
            LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(8)
                bottomMargin = dp(4)
            },
        )
    }

    private fun shape(color: Int, radius: Int) =
        RippleDrawable(
            ColorStateList.valueOf(0x26FFFFFF),
            GradientDrawable().apply {
                cornerRadius = dp(radius).toFloat()
                setColor(color)
            },
            null,
        )

    fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}
