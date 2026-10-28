package com.noted.wear.surfaces

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.*
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.noted.wear.data.WatchData
import com.noted.wear.data.WatchStore
import com.noted.wear.ui.WatchActivity
import java.time.Instant
import java.util.concurrent.TimeUnit

abstract class NotedComplication : SuspendingComplicationDataSourceService() {
    fun plain(text: String) = PlainComplicationText.Builder(text).build()

    fun open() =
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, WatchActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun text(
        type: ComplicationType,
        value: ComplicationText,
        title: String = "Noted",
    ): ComplicationData =
        if (type == ComplicationType.LONG_TEXT)
            LongTextComplicationData.Builder(value, plain(title))
                .setTitle(plain(title))
                .setTapAction(open())
                .build()
        else
            ShortTextComplicationData.Builder(value, plain(title))
                .setTitle(plain(title))
                .setTapAction(open())
                .build()

    override fun getPreviewData(type: ComplicationType): ComplicationData =
        text(type, plain("Noted"))
}

class ActivityComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        val snapshot = WatchStore(this).snapshot()
        val hidden = snapshot?.optJSONObject("settings")?.optBoolean("hide_contents") == true
        val current = snapshot?.let { WatchData.current(it) }
        val value =
            when {
                snapshot == null -> "Open Noted"
                current == null -> "Not tracking"
                hidden -> "Tracking"
                else -> current.optString("name")
            }
        return text(request.complicationType, plain(value), "Current activity")
    }
}

class ElapsedComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        val snapshot =
            WatchStore(this).snapshot() ?: return text(request.complicationType, plain("--:--"))
        val elapsed = WatchData.elapsed(snapshot)
        val tracker = snapshot.getJSONObject("tracker")
        val value =
            if (tracker.optJSONObject("active") != null) {
                TimeDifferenceComplicationText.Builder(
                        TimeDifferenceStyle.STOPWATCH,
                        CountUpTimeReference(Instant.now().minusSeconds(elapsed)),
                    )
                    .setMinimumTimeUnit(TimeUnit.MINUTES)
                    .build()
            } else if (WatchData.current(snapshot) != null) plain(WatchData.duration(elapsed))
            // With nothing tracked, the faces show what today added up to instead.
            else plain("${WatchData.hours(WatchData.trackedToday(snapshot))} today")
        return text(request.complicationType, value, "Tracked time")
    }
}

class NextPlanComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        val snapshot = WatchStore(this).snapshot()
        val plan = snapshot?.let { WatchData.plans(it).firstOrNull() }
        val hidden = snapshot?.optJSONObject("settings")?.optBoolean("hide_contents") == true
        return text(
            request.complicationType,
            plain(
                if (plan == null) "No upcoming plans"
                else if (hidden) WatchData.time(plan.getString("start_at"))
                else "${WatchData.time(plan.getString("start_at"))} ${plan.getString("title")}"
            ),
            "Next plan",
        )
    }
}

class AgendaComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData =
        image()

    override fun getPreviewData(type: ComplicationType): ComplicationData = image()

    private fun image(): ComplicationData =
        SmallImageComplicationData.Builder(
                SmallImage.Builder(
                        Icon.createWithBitmap(FaceRenderer.render(WatchStore(this).snapshot())),
                        SmallImageType.PHOTO,
                    )
                    .build(),
                plain("Noted agenda"),
            )
            .setTapAction(open())
            .build()
}

/**
 * How much of the planned block running now is left (for the ring that empties)
 * and, as its title, the next plan. Faces read both from this one slot.
 */
class PlanComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        val snapshot = WatchStore(this).snapshot()
        val now = Instant.now()
        val block = snapshot?.let { WatchData.currentPlan(it, now) }
        val left =
            block?.let {
                val start = Instant.parse(it.getString("start_at")).epochSecond
                val end = Instant.parse(it.getString("end_at")).epochSecond
                ((end - now.epochSecond).toFloat() / (end - start)).coerceIn(0f, 1f) to
                    (end - now.epochSecond) / 60
            }
        val hidden = snapshot?.optJSONObject("settings")?.optBoolean("hide_contents") == true
        val next =
            snapshot
                ?.let { WatchData.plans(it).firstOrNull { plan -> plan.optString("id") != block?.optString("id") } }
                ?.let {
                    val time = WatchData.time(it.getString("start_at"))
                    if (hidden) time else "$time ${it.getString("title")}"
                } ?: "No more plans today"
        return RangedValueComplicationData.Builder(left?.first ?: 0f, 0f, 1f, plain(next))
            .setText(plain(left?.let { "${it.second}m left" } ?: " "))
            .setTitle(plain(next))
            .setTapAction(open())
            .build()
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData =
        RangedValueComplicationData.Builder(.6f, 0f, 1f, plain("11:00 Walk outside"))
            .setText(plain("52m left"))
            .setTitle(plain("11:00 Walk outside"))
            .build()
}

/** A swatch of the current activity's colour; Colour field stretches it across the face. */
class ColourComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData =
        swatch(WatchStore(this).snapshot()?.let { WatchData.current(it) }?.optString("color"))

    override fun getPreviewData(type: ComplicationType): ComplicationData = swatch("#e2c15a")

    private fun swatch(color: String?): ComplicationData {
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(
            runCatching { Color.parseColor(color) }.getOrDefault(Color.rgb(91, 97, 90)),
        )
        return SmallImageComplicationData.Builder(
                SmallImage.Builder(Icon.createWithBitmap(bitmap), SmallImageType.PHOTO).build(),
                plain("Activity colour"),
            )
            .setTapAction(open())
            .build()
    }
}
