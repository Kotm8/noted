package com.noted.wear.ui

import android.content.Context
import android.view.MotionEvent
import android.view.ViewGroup
import android.widget.ScrollView
import kotlin.math.abs
import kotlin.math.sqrt

class RoundScrollView(context: Context) : ScrollView(context) {
    private val density = resources.displayMetrics.density

    init {
        isVerticalScrollBarEnabled = false
        clipToPadding = false
        isFocusable = true
        setPadding(dp(24), dp(36), dp(24), dp(58))
        setOnGenericMotionListener { _, event ->
            if (event.action == MotionEvent.ACTION_SCROLL) {
                smoothScrollBy(0, (-event.getAxisValue(MotionEvent.AXIS_SCROLL) * dp(32)).toInt())
                true
            } else false
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        fitRows()
    }

    override fun onScrollChanged(left: Int, top: Int, oldLeft: Int, oldTop: Int) {
        super.onScrollChanged(left, top, oldLeft, oldTop)
        fitRows()
    }

    private fun fitRows() {
        if (!resources.configuration.isScreenRound) return
        val content = getChildAt(0) as? ViewGroup ?: return
        val radius = width / 2f
        for (index in 0 until content.childCount) {
            val row = content.getChildAt(index)
            val center = paddingTop + row.top + row.height / 2f - scrollY
            val distance = abs(center - height / 2f)
            val chord = 2f * sqrt((radius * radius - distance * distance).coerceAtLeast(0f))
            val scale = ((chord - dp(20)) / row.width.coerceAtLeast(1)).coerceIn(.65f, 1f)
            row.scaleX = scale
            row.scaleY = scale
            row.alpha = if (distance > radius * .86f) .55f else 1f
        }
    }

    private fun dp(value: Int) = (value * density).toInt()
}
