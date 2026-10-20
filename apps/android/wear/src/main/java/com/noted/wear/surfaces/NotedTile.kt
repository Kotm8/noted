package com.noted.wear.surfaces

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import com.noted.wear.data.WatchData
import com.noted.wear.data.WatchStore
import com.noted.wear.ui.WatchActivity

class NotedTile : TileService() {
    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest
    ): ListenableFuture<TileBuilders.Tile> {
        val snapshot = WatchStore(this).snapshot()
        val current = snapshot?.let { WatchData.current(it)?.optString("name") } ?: "Open Noted"
        val hidden = snapshot?.optJSONObject("settings")?.optBoolean("hide_contents") == true
        val next = snapshot?.let { WatchData.plans(it).firstOrNull() }
        fun text(value: String, size: Float) =
            LayoutElementBuilders.Text.Builder()
                .setText(value)
                .setFontStyle(
                    LayoutElementBuilders.FontStyle.Builder()
                        .setSize(DimensionBuilders.sp(size))
                        .build()
                )
                .build()
        val open =
            ActionBuilders.LaunchAction.Builder()
                .setAndroidActivity(
                    ActionBuilders.AndroidActivity.Builder()
                        .setPackageName(packageName)
                        .setClassName(WatchActivity::class.java.name)
                        .build()
                )
                .build()
        val column =
            LayoutElementBuilders.Column.Builder()
                .setWidth(DimensionBuilders.expand())
                .setHeight(DimensionBuilders.expand())
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .addContent(text("NOTED", 12f))
                .addContent(text(if (hidden) "Current activity" else current, 20f))
                .addContent(
                    text(
                        snapshot?.let { WatchData.duration(WatchData.elapsed(it)) }
                            ?: "Pair on your phone",
                        18f,
                    )
                )
                .addContent(
                    text(
                        if (next == null) "No upcoming plans"
                        else
                            "${WatchData.time(next.getString("start_at"))} / ${if (hidden) "Next plan" else next.getString("title")}",
                        12f,
                    )
                )
                .setModifiers(
                    ModifiersBuilders.Modifiers.Builder()
                        .setPadding(
                            ModifiersBuilders.Padding.Builder()
                                .setTop(DimensionBuilders.dp(35f))
                                .setBottom(DimensionBuilders.dp(25f))
                                .setStart(DimensionBuilders.dp(24f))
                                .setEnd(DimensionBuilders.dp(24f))
                                .build()
                        )
                        .setClickable(
                            ModifiersBuilders.Clickable.Builder()
                                .setId("noted-open")
                                .setOnClick(open)
                                .build()
                        )
                        .build()
                )
                .build()
        return immediate(
            TileBuilders.Tile.Builder()
                .setResourcesVersion("1")
                .setFreshnessIntervalMillis(900000)
                .setTileTimeline(
                    TimelineBuilders.Timeline.Builder()
                        .addTimelineEntry(
                            TimelineBuilders.TimelineEntry.Builder()
                                .setLayout(
                                    LayoutElementBuilders.Layout.Builder().setRoot(column).build()
                                )
                                .build()
                        )
                        .build()
                )
                .build()
        )
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> =
        immediate(ResourceBuilders.Resources.Builder().setVersion("1").build())

    private fun <T> immediate(value: T): ListenableFuture<T> =
        CallbackToFutureAdapter.getFuture { completer ->
            completer.set(value)
            "noted-tile"
        }
}
