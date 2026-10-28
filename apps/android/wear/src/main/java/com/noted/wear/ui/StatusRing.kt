package com.noted.wear.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RectF
import android.view.View
import android.view.animation.DecelerateInterpolator

/**
 * C2's confirmation: the ring draws itself, then the check. The error variant
 * is the same ring with an exclamation mark, drawn at once.
 */
class StatusRing(context: Context, private val success: Boolean, color: Int) : View(context) {
    private val track =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            this.color = Color.rgb(43, 46, 44)
        }
    private val stroke =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            this.color = color
        }
    private val bounds = RectF()
    private val mark = Path()
    private val partial = Path()
    private var progress = if (success) 0f else 1f

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        if (success && ValueAnimator.areAnimatorsEnabled())
            ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 800
                interpolator = DecelerateInterpolator()
                addUpdateListener {
                    progress = it.animatedValue as Float
                    invalidate()
                }
                start()
            }
        else progress = 1f
    }

    override fun onDraw(canvas: Canvas) {
        val size = minOf(width, height).toFloat()
        val weight = size * .075f
        track.strokeWidth = weight
        stroke.strokeWidth = weight
        bounds.set(weight, weight, size - weight, size - weight)
        bounds.offset((width - size) / 2, (height - size) / 2)
        canvas.drawOval(bounds, track)
        val ring = (progress / .7f).coerceAtMost(1f)
        canvas.drawArc(bounds, -90f, 360f * ring, false, stroke)
        val x = bounds.centerX()
        val y = bounds.centerY()
        val unit = bounds.width() / 2
        mark.reset()
        if (success) {
            mark.moveTo(x - unit * .38f, y + unit * .02f)
            mark.lineTo(x - unit * .1f, y + unit * .3f)
            mark.lineTo(x + unit * .4f, y - unit * .26f)
        } else {
            mark.moveTo(x, y - unit * .4f)
            mark.lineTo(x, y + unit * .1f)
            mark.moveTo(x, y + unit * .36f)
            mark.lineTo(x, y + unit * .38f)
        }
        val drawn = ((progress - .55f) / .45f).coerceIn(0f, 1f)
        if (drawn >= 1f) canvas.drawPath(mark, stroke)
        else if (drawn > 0f) {
            val measure = PathMeasure(mark, false)
            partial.reset()
            measure.getSegment(0f, measure.length * drawn, partial, true)
            canvas.drawPath(partial, stroke)
        }
    }
}
