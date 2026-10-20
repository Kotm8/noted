package com.noted.android.watch

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.TimeUnit

object WatchConnection {
    fun save(context: Context, origin: String, nodeId: String) {
        context
            .getSharedPreferences("paired_watches", Context.MODE_PRIVATE)
            .edit()
            .putString(origin, nodeId)
            .apply()
    }

    fun receivesOwnNotifications(context: Context, origin: String): Boolean {
        val nodeId =
            context
                .getSharedPreferences("paired_watches", Context.MODE_PRIVATE)
                .getString(origin, null) ?: return false
        return runCatching {
                Tasks.await(
                        Wearable.getCapabilityClient(context)
                            .getCapability("noted_watch", CapabilityClient.FILTER_REACHABLE),
                        2,
                        TimeUnit.SECONDS,
                    )
                    .nodes
                    .any { it.id == nodeId }
            }
            .getOrDefault(false)
    }
}
