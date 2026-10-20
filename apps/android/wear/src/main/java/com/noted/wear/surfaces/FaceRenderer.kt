package com.noted.wear.surfaces

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.noted.wear.data.WatchData
import java.time.Instant
import org.json.JSONObject

object FaceRenderer {
    fun render(snapshot: JSONObject?): Bitmap {
        val bitmap = Bitmap.createBitmap(400, 280, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val settings = snapshot?.optJSONObject("settings") ?: JSONObject()
        val accent =
            runCatching { Color.parseColor(settings.optString("accent", "#e2c15a")) }
                .getOrDefault(Color.rgb(226, 193, 90))
        val scale = settings.optDouble("text_scale", 1.0).toFloat()
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        fun text(value: String, x: Float, y: Float, size: Float, color: Int = Color.WHITE) {
            paint.color = color
            paint.textSize = size * scale
            paint.typeface = Typeface.DEFAULT
            var fitted = value
            while (fitted.isNotEmpty() && paint.measureText(fitted) > 390 - x) fitted =
                fitted.dropLast(1)
            canvas.drawText(
                if (fitted.length < value.length && fitted.isNotEmpty()) fitted.dropLast(1) + "…"
                else fitted,
                x,
                y,
                paint,
            )
        }
        if (snapshot == null) {
            text("Open Noted to pair", 45f, 130f, 25f)
            return bitmap
        }
        val hidden = settings.optBoolean("hide_contents")
        val name =
            if (hidden) "Current activity"
            else WatchData.current(snapshot)?.optString("name") ?: "Nothing active"
        val plans = WatchData.plans(snapshot).take(3)
        val reminders = WatchData.items(snapshot.getJSONObject("board").optJSONArray("reminders"))
        if (settings.optString("face", "W16") == "W24") {
            val start = Instant.now().epochSecond - 3600
            val end = start + settings.optInt("schedule_hours", 4) * 3600
            fun x(epoch: Long) =
                (10 + (epoch - start).toFloat() / (end - start) * 380).coerceIn(10f, 390f)
            text("PLANNED", 12f, 24f, 12f, Color.GRAY)
            plans.forEach { plan ->
                val left = x(Instant.parse(plan.getString("start_at")).epochSecond)
                val right = x(Instant.parse(plan.getString("end_at")).epochSecond)
                if (right > left) {
                    paint.color = Color.rgb(36, 48, 36)
                    canvas.drawRoundRect(left, 38f, right, 104f, 6f, 6f, paint)
                    text(
                        if (hidden) "Plan" else plan.getString("title"),
                        left + 6,
                        78f,
                        18f,
                        accent,
                    )
                }
            }
            text("ACTUAL", 12f, 153f, 12f, Color.GRAY)
            WatchData.items(snapshot.getJSONObject("board").optJSONArray("sessions")).forEach {
                session ->
                val left = x(Instant.parse(session.getString("started_at")).epochSecond)
                val right =
                    x(
                        session
                            .optString("ended_at")
                            .takeUnless { it.isBlank() || it == "null" }
                            ?.let { Instant.parse(it).epochSecond } ?: Instant.now().epochSecond
                    )
                if (right > left) {
                    paint.color = accent
                    canvas.drawRoundRect(left, 168f, right, 201f, 4f, 4f, paint)
                }
            }
            paint.color = accent
            paint.strokeWidth = 1.5f
            canvas.drawLine(
                x(Instant.now().epochSecond),
                32f,
                x(Instant.now().epochSecond),
                212f,
                paint,
            )
            text(name, 14f, 252f, 24f)
        } else {
            if (settings.optString("face") == "W07") {
                paint.color = Color.rgb(60, 73, 55)
                paint.strokeWidth = 1.5f
                canvas.drawLine(5f, 113f, 5f, 210f, paint)
                plans.take(2).forEachIndexed { index, _ ->
                    paint.color = accent
                    canvas.drawCircle(5f, 131f + index * 49, 4f, paint)
                }
            }
            text(
                if (snapshot.getJSONObject("tracker").optJSONObject("active") != null)
                    "CURRENT ACTIVITY"
                else "PAUSED / IDLE",
                14f,
                24f,
                12f,
                accent,
            )
            text(name, 14f, 60f, 29f)
            paint.color = Color.rgb(50, 57, 46)
            canvas.drawLine(14f, 96f, 386f, 96f, paint)
            plans.take(2).forEachIndexed { index, plan ->
                val y = 137f + index * 49
                text(WatchData.time(plan.getString("start_at")), 14f, y, 19f, accent)
                text(if (hidden) "Planned activity" else plan.getString("title"), 105f, y, 24f)
            }
            reminders.firstOrNull()?.let {
                text(
                    if (hidden) "Reminder" else it.optString("content"),
                    14f,
                    250f,
                    17f,
                    Color.LTGRAY,
                )
            }
        }
        return bitmap
    }
}
