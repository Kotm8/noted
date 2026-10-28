package com.noted.android.web

import android.animation.AnimatorSet
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
import android.view.animation.Interpolator
import android.view.animation.LinearInterpolator
import android.widget.LinearLayout
import android.widget.ProgressBar
import androidx.core.graphics.PathParser
import androidx.core.view.animation.PathInterpolatorCompat

class StartupView(context: Context) : LinearLayout(context) {
    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.rgb(31, 31, 31))
        // The dot's loop reaches well outside the logo's box.
        clipChildren = false
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

private fun path(data: String) = PathParser.createPathFromPathData(data)!!
private fun bezier(x1: Float, y1: Float, x2: Float, y2: Float) = PathInterpolatorCompat.create(x1, y1, x2, y2)
private val easeIn = bezier(.42f, 0f, 1f, 1f)
private val easeOut = bezier(0f, 0f, .58f, 1f)
private val easeInOut = bezier(.42f, 0f, .58f, 1f)
private val windUp = bezier(.6f, 0f, 1f, .6f)
private val launch = bezier(.12f, .75f, .3f, 1f)

/** One keyframe span: eases from [from] to [to] while the cycle is between [start] and [end]. */
private fun tween(time: Float, start: Float, end: Float, from: Float, to: Float, easing: Interpolator) =
    from + (to - from) * easing.getInterpolation(((time - start) / (end - start)).coerceIn(0f, 1f))

/**
 * Mirrors apps/web/public/startup.css: the n draws, then while loading its right leg
 * kicks the dot, which loops anti-clockwise around the n and lands back at the foot.
 */
private class LogoView(context: Context) : View(context) {
    private val glyph = path("M26.7 32H39.5V37.7C42.4 33.2 46.4 30.8 51.9 30.8C61.2 30.8 65.6 37 65.6 47V71H52.8V48.6C52.8 42.7 51.2 40 47.1 40C42.1 40 39.5 43.7 39.5 50.4V71H26.7V32Z")
    private val legBox = path("M52 49H67V72H52Z")
    /** Everything but the lower right leg, which is drawn separately so it can bend. */
    private val body = Path().apply { op(glyph, legBox, Path.Op.DIFFERENCE) }
    /** The leg's top is round and centred on the knee, so no corner shows as it turns. */
    private val leg = Path().apply { op(glyph, path("M52.8 72V49A6.4 6.4 0 0 1 65.6 49V72Z"), Path.Op.INTERSECT) }
    private val knee = Path().apply { addCircle(59.2f, 49f, 6.4f, Path.Direction.CW) }
    private val dot = path("M67.5 72C71.4765 72 74.7 69.0899 74.7 65.5C74.7 61.9101 71.4765 59 67.5 59C63.5236 59 60.3 61.9101 60.3 65.5C60.3 69.0899 63.5236 72 67.5 72Z")
    private val curve = path("M37 44Q60 19 59.2 48V71")
    private val measure = PathMeasure(curve, false)
    private val orbit = PathMeasure(path("M67.5 65.5L69.16 67.6A45 48 0 0 0 11.14 -5.8A45 48 0 0 0 69.16 67.6L67.5 65.5"), false)
    private val orbitPoint = FloatArray(2)
    private val segment = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var progress = 0f
    private var cycle = 0f
    private val drawing = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 840
        addUpdateListener { progress = it.animatedValue as Float; invalidate() }
    }
    private val kicking = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 2400
        startDelay = 260
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener { cycle = it.animatedValue as Float; invalidate() }
    }
    private val animator = AnimatorSet().apply { playSequentially(drawing, kicking) }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (ValueAnimator.areAnimatorsEnabled()) animator.start() else progress = 1f
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }

    private fun legAngle(time: Float) = when {
        time < .06f -> tween(time, 0f, .06f, 0f, 14f, easeOut)
        time < .10f -> tween(time, .06f, .10f, 14f, -26f, windUp)
        else -> tween(time, .10f, .22f, -26f, 0f, easeInOut)
    }

    private fun travelled(time: Float) = tween(time, .10f, .56f, 0f, 1f, launch)

    /** Horizontal and vertical squash: struck at 10%, landing at 61%. */
    private fun squash(time: Float): Pair<Float, Float> = when {
        time < .08f -> 1f to 1f
        time < .10f -> tween(time, .08f, .10f, 1f, .72f, easeIn) to tween(time, .08f, .10f, 1f, 1.25f, easeIn)
        time < .56f -> tween(time, .10f, .56f, .72f, 1f, launch) to tween(time, .10f, .56f, 1.25f, 1f, launch)
        time < .61f -> tween(time, .56f, .61f, 1f, 1.22f, easeOut) to tween(time, .56f, .61f, 1f, .8f, easeOut)
        else -> tween(time, .61f, .68f, 1.22f, 1f, easeInOut) to tween(time, .61f, .68f, .8f, 1f, easeInOut)
    }

    /** Paints the part of the n revealed so far, within whatever clip is active. */
    private fun reveal(canvas: Canvas) {
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
    }

    private fun drawPart(canvas: Canvas, clip: Path, angle: Float = 0f) {
        canvas.save()
        canvas.rotate(angle, 59.2f, 49f)
        canvas.clipPath(clip)
        reveal(canvas)
        canvas.restore()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save()
        canvas.scale(width / 98f, height / 96f)
        drawPart(canvas, body)
        drawPart(canvas, knee)
        drawPart(canvas, leg, legAngle(cycle))
        orbit.getPosTan(orbit.length * travelled(cycle) % orbit.length, orbitPoint, null)
        val (wide, tall) = squash(cycle)
        canvas.translate(orbitPoint[0] - 67.5f, orbitPoint[1] - 65.5f)
        canvas.scale(wide, tall, 67.5f, 65.5f)
        paint.style = Paint.Style.FILL
        paint.color = Color.rgb(226, 193, 90)
        paint.alpha = (255 * ((progress - .81f) / .19f).coerceIn(0f, 1f)).toInt()
        canvas.drawPath(dot, paint)
        paint.alpha = 255
        canvas.restore()
    }
}
