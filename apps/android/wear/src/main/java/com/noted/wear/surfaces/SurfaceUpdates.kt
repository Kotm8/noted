package com.noted.wear.surfaces

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester

object SurfaceUpdates {
    fun request(context: Context) {
        listOf(
                ActivityComplication::class.java,
                ElapsedComplication::class.java,
                AgendaComplication::class.java,
                NextPlanComplication::class.java,
                PlanComplication::class.java,
                ColourComplication::class.java,
            )
            .forEach { type ->
                ComplicationDataSourceUpdateRequester.create(context, ComponentName(context, type))
                    .requestUpdateAll()
            }
        TileService.getUpdater(context).requestUpdate(NotedTile::class.java)
    }
}
