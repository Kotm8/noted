package com.noted.android.watch

import android.content.Context

object WatchConnection {
    fun save(context: Context, origin: String, nodeId: String) {
        context
            .getSharedPreferences("paired_watches", Context.MODE_PRIVATE)
            .edit()
            .putString(origin, nodeId)
            .apply()
    }
}
