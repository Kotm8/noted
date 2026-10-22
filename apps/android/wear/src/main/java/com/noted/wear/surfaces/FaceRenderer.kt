package com.noted.wear.surfaces

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import com.noted.wear.data.WatchData
import java.time.Instant
import org.json.JSONObject

object FaceRenderer {
    fun render(snapshot: JSONObject?): Bitmap {
        val bitmap = Bitmap.createBitmap(280, 190, Bitmap.Config.ARGB_8888)
        val agenda = AgendaCanvas(Canvas(bitmap), snapshot)
        if (snapshot == null) agenda.unpaired()
        else if (snapshot.optJSONObject("settings")?.optString("face") == "W24") agenda.schedule()
        else agenda.queue()
        return bitmap
    }
}

private class AgendaCanvas(private val canvas: Canvas, private val snapshot: JSONObject?) {
    private val settings = snapshot?.optJSONObject("settings") ?: JSONObject()
    private val scale = settings.optDouble("text_scale", 1.0).toFloat().coerceIn(.85f, 1.3f)
    private val accent = runCatching {
        Color.parseColor(settings.optString("accent", "#e2c15a"))
    }
        .getOrDefault(Color.rgb(226, 193, 90))
    private val muted = Color.rgb(156, 160, 157)
    private val rule = Color.rgb(51, 55, 52)
    private val hidden = settings.optBoolean("hide_contents")
    private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val current = snapshot?.let { WatchData.current(it) }
    private val name =
        if (hidden) "Current activity" else current?.optString("name") ?: "Nothing active"
    private val plans = snapshot?.let { WatchData.plans(it) }.orEmpty()

    fun unpaired() {
        text("YOUR DAY, AT A GLANCE", 0f, 29f, 11f, muted)
        text("Welcome to Noted", 0f, 73f, 26f)
        text("Open the app to pair your watch.", 0f, 108f, 15f, muted)
    }

    fun queue() {
        val running = snapshot!!.getJSONObject("tracker").optJSONObject("active") != null
        text(
            if (running) "TRACKING" else if (current != null) "PAUSED" else "NOT TRACKING",
            0f,
            17f,
            11f,
            if (running) accent else muted,
        )
        text(name, 0f, 51f, 27f)
        line(0f, 73f, 280f, 73f)
        val rail = settings.optString("face") == "W07"
        if (rail && plans.isNotEmpty()) line(3f, 96f, 3f, if (plans.size > 1) 147f else 112f)
        val gutter = if (rail) 15f else 0f
        plans.take(2).forEachIndexed { index, plan ->
            val y = 110f + index * 36f
            if (rail) {
                paint.color = accent
                canvas.drawCircle(3f, y - 6, 3f, paint)
            }
            text(
                WatchData.time(plan.getString("start_at"), plan.optString("timezone", "UTC")),
                gutter,
                y,
                15f,
                muted,
                width = 64f,
                mono = true,
            )
            text(
                if (hidden) "Planned activity" else plan.getString("title"),
                gutter + 72,
                y,
                20f,
                width = 280 - gutter - 72,
            )
        }
        if (plans.isEmpty()) text("No upcoming plans", 0f, 112f, 18f, muted)
        val reminder =
            WatchData.items(snapshot.getJSONObject("board").optJSONArray("reminders")).minByOrNull {
                it.optString("due_at")
            }
        if (reminder != null)
            text(
                if (hidden) "Upcoming reminder" else reminder.optString("content"),
                0f,
                180f,
                13f,
                muted,
            )
    }

    fun schedule() {
        val now = Instant.now().epochSecond
        val start = now - 3600
        val window = settings.optInt("schedule_hours", 4).coerceIn(2, 8) * 3600
        fun x(epoch: Long) = ((epoch - start).toFloat() / window * 280).coerceIn(0f, 280f)
        text("PLANNED", 0f, 14f, 11f, muted)
        plans.forEach { plan ->
            val left = x(Instant.parse(plan.getString("start_at")).epochSecond)
            val right = x(Instant.parse(plan.getString("end_at")).epochSecond)
            if (right > left) {
                paint.color = Color.rgb(34, 38, 35)
                canvas.drawRoundRect(left, 27f, right, 66f, 4f, 4f, paint)
                if (right - left > 24f)
                    text(
                        if (hidden) "Plan" else plan.getString("title").substringBefore(' '),
                        left + 3,
                        51f,
                        if (right - left < 60f) 12f else 15f,
                        width = right - left - 6,
                    )
            }
        }
        for (hour in 0 until settings.optInt("schedule_hours", 4).coerceIn(2, 8)) {
            val at = start + hour * 3600
            text(
                WatchData.time(Instant.ofEpochSecond(at).toString()).take(2),
                x(at),
                84f,
                10f,
                muted,
                width = 30f,
                mono = true,
            )
        }
        text("ACTUAL", 0f, 107f, 11f, muted)
        WatchData.items(snapshot!!.getJSONObject("board").optJSONArray("sessions")).forEach {
            session ->
            val left = x(Instant.parse(session.getString("started_at")).epochSecond)
            val right =
                x(
                    session
                        .optString("ended_at")
                        .takeUnless { it.isBlank() || it == "null" }
                        ?.let { Instant.parse(it).epochSecond } ?: now,
                )
            if (right > left) {
                paint.color = accent
                canvas.drawRoundRect(left, 118f, right, 136f, 3f, 3f, paint)
            }
        }
        paint.color = accent
        paint.strokeWidth = 1f
        canvas.drawLine(x(now), 22f, x(now), 141f, paint)
        text(name, 0f, 163f, 23f)
        plans
            .firstOrNull { Instant.parse(it.getString("start_at")).epochSecond >= now }
            ?.let {
                val next = if (hidden) "Planned activity" else it.getString("title")
                text("${WatchData.time(it.getString("start_at"))} / $next", 0f, 185f, 13f, muted)
            }
    }

    private fun text(
        value: String,
        x: Float,
        y: Float,
        size: Float,
        color: Int = Color.WHITE,
        width: Float = 280 - x,
        mono: Boolean = false,
    ) {
        paint.color = color
        paint.textSize = size * scale
        paint.typeface =
            if (mono) Typeface.MONOSPACE else Typeface.create("sans-serif", Typeface.NORMAL)
        val fitted =
            TextUtils.ellipsize(value, paint, width.coerceAtLeast(0f), TextUtils.TruncateAt.END)
        canvas.drawText(fitted.toString(), x, y, paint)
    }

    private fun line(left: Float, top: Float, right: Float, bottom: Float) {
        paint.color = rule
        paint.strokeWidth = 1f
        canvas.drawLine(left, top, right, bottom, paint)
    }
}
