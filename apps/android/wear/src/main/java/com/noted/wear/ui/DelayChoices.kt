package com.noted.wear.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

class DelayChoices(
    context: Context,
    selected: Int,
    accent: Int,
    scale: Float,
    onSelect: (Int) -> Unit,
) : LinearLayout(context) {
    init {
        orientation = VERTICAL
        listOf(5, 10, 15, 30, 60).chunked(3).forEach { values ->
            val row = LinearLayout(context)
            values.forEach { minutes ->
                val shape =
                    GradientDrawable().apply {
                        cornerRadius = dp(18).toFloat()
                        setColor(if (minutes == selected) 0x28FFFFFF else 0xFF202321.toInt())
                        if (minutes == selected) setStroke(dp(1), accent)
                    }
                row.addView(
                    TextView(context).apply {
                        text = if (minutes == 60) "1 hour" else "$minutes min"
                        contentDescription = if (minutes == 60) "1 hour" else "$minutes minutes"
                        isSelected = minutes == selected
                        stateDescription = if (isSelected) "Selected" else "Not selected"
                        textSize = 12f * scale
                        gravity = Gravity.CENTER
                        setTextColor(if (isSelected) accent else Color.WHITE)
                        background =
                            RippleDrawable(ColorStateList.valueOf(0x26FFFFFF), shape, shape)
                        isClickable = true
                        isFocusable = true
                        setOnClickListener { onSelect(minutes) }
                    },
                    LayoutParams(0, dp(36), 1f).apply { setMargins(dp(2), dp(2), dp(2), dp(2)) },
                )
            }
            addView(row, LayoutParams(-1, -2))
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
