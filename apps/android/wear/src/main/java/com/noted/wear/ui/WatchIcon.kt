package com.noted.wear.ui

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable

class WatchIcon(private val name: String, color: Int) : Drawable() {
    private val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 1.8f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

    override fun draw(canvas: Canvas) {
        canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        val path = Path()
        when (name) {
            "back" -> {
                path.moveTo(14f, 5f)
                path.lineTo(7f, 12f)
                path.lineTo(14f, 19f)
            }
            "next" -> {
                path.moveTo(9f, 5f)
                path.lineTo(16f, 12f)
                path.lineTo(9f, 19f)
            }
            "pause" -> {
                path.moveTo(8f, 5f)
                path.lineTo(8f, 19f)
                path.moveTo(16f, 5f)
                path.lineTo(16f, 19f)
            }
            "stop" -> path.addRect(6f, 6f, 18f, 18f, Path.Direction.CW)
            "play" -> {
                path.moveTo(8f, 4f)
                path.lineTo(20f, 12f)
                path.lineTo(8f, 20f)
                path.close()
            }
            "check" -> {
                path.moveTo(4f, 12f)
                path.lineTo(10f, 18f)
                path.lineTo(21f, 5f)
            }
            "flag",
            "Flag" -> {
                path.moveTo(5f, 21f)
                path.lineTo(5f, 3f)
                path.lineTo(20f, 3f)
                path.lineTo(16f, 8f)
                path.lineTo(20f, 12f)
                path.lineTo(5f, 12f)
            }
            "BookOpen" -> {
                path.moveTo(12f, 5f)
                path.lineTo(12f, 21f)
                path.moveTo(2f, 3f)
                path.lineTo(8f, 3f)
                path.lineTo(12f, 5f)
                path.lineTo(16f, 3f)
                path.lineTo(22f, 3f)
                path.lineTo(22f, 19f)
                path.lineTo(16f, 19f)
                path.lineTo(12f, 21f)
                path.lineTo(8f, 19f)
                path.lineTo(2f, 19f)
                path.close()
            }
            "Code2" -> {
                path.moveTo(7f, 5f)
                path.lineTo(1f, 12f)
                path.lineTo(7f, 19f)
                path.moveTo(17f, 5f)
                path.lineTo(23f, 12f)
                path.lineTo(17f, 19f)
                path.moveTo(14f, 2f)
                path.lineTo(10f, 22f)
            }
            else -> {
                path.addCircle(12f, 12f, 8f, Path.Direction.CW)
                path.moveTo(12f, 7f)
                path.lineTo(12f, 12f)
                path.lineTo(16f, 14f)
            }
        }
        canvas.drawPath(path, paint)
        canvas.restore()
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
    }

    @Suppress("DEPRECATION") override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
