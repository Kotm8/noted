package com.noted.wear.surfaces

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.*
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.noted.wear.data.WatchData
import com.noted.wear.data.WatchStore
import com.noted.wear.ui.WatchActivity
import java.time.Instant

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
        val value =
            if (hidden) "Tracking"
            else snapshot?.let { WatchData.current(it)?.optString("name") } ?: "Open Noted"
        return text(request.complicationType, plain(value), "Current activity")
    }
}

class ElapsedComplication : NotedComplication() {
    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        val snapshot =
            WatchStore(this).snapshot() ?: return text(request.complicationType, plain("--:--"))
        val elapsed = WatchData.elapsed(snapshot)
        val value =
            if (snapshot.getJSONObject("tracker").optJSONObject("active") != null) {
                TimeDifferenceComplicationText.Builder(
                        TimeDifferenceStyle.STOPWATCH,
                        CountUpTimeReference(Instant.now().minusSeconds(elapsed)),
                    )
                    .build()
            } else plain(WatchData.duration(elapsed))
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
