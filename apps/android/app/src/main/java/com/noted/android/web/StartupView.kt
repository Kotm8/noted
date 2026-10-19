package com.noted.android.web

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import androidx.core.graphics.PathParser

class StartupView(context: Context) : LinearLayout(context) {
    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.rgb(31, 31, 31))
        val density = resources.displayMetrics.density
        addView(LogoView(context), LayoutParams((112 * density).toInt(), (110 * density).toInt()))
        addView(ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(Color.rgb(226, 193, 90))
        }, LayoutParams((112 * density).toInt(), (2 * density).toInt()).apply {
            topMargin = (22 * density).toInt()
        })
        contentDescription = "Connecting to Noted"
    }
}

private class LogoView(context: Context) : View(context) {
    private val glyph = PathParser.createPathFromPathData("M26.7 32H39.5V37.7C42.4 33.2 46.4 30.8 51.9 30.8C61.2 30.8 65.6 37 65.6 47V71H52.8V48.6C52.8 42.7 51.2 40 47.1 40C42.1 40 39.5 43.7 39.5 50.4V71H26.7V32Z")!!
    private val dot = PathParser.createPathFromPathData("M67.5 72C71.4765 72 74.7 69.0899 74.7 65.5C74.7 61.9101 71.4765 59 67.5 59C63.5236 59 60.3 61.9101 60.3 65.5C60.3 69.0899 63.5236 72 67.5 72Z")!!
    private val curve = PathParser.createPathFromPathData("M37 44Q60 19 59.2 48V71")!!
    private val measure = PathMeasure(curve, false)
    private val segment = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var progress = 0f
    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 840
        addUpdateListener { progress = it.animatedValue as Float; invalidate() }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (ValueAnimator.areAnimatorsEnabled()) animator.start() else progress = 1f
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save()
        canvas.scale(width / 98f, height / 96f)
        canvas.save()
        canvas.clipPath(glyph)
        paint.color = Color.rgb(204, 204, 204)
        paint.style = Paint.Style.FILL
        canvas.drawRect(26.7f, 32f, 39.5f, 32f + 39f * (progress / .28f).coerceIn(0f, 1f), paint)
        val fraction = ((progress - .28f) / .51f).coerceIn(0f, 1f)
        segment.reset()
        measure.getSegment(0f, measure.length * fraction, segment, true)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 20f
        canvas.drawPath(segment, paint)
        if (fraction == 1f) {
            paint.style = Paint.Style.FILL
            canvas.drawRect(39.5f, 30.8f, 65.6f, 71f, paint)
        }
        canvas.restore()
        paint.style = Paint.Style.FILL
        paint.color = Color.rgb(226, 193, 90)
        paint.alpha = (255 * ((progress - .81f) / .19f).coerceIn(0f, 1f)).toInt()
        canvas.drawPath(dot, paint)
        paint.alpha = 255
        canvas.restore()
    }
}
