package com.noted.wear.data

import android.content.Context
import com.noted.wear.notifications.WatchPush
import com.noted.wear.surfaces.SurfaceUpdates
import org.json.JSONObject

class WatchRepository(private val context: Context) {
    private val store = WatchStore(context)
    private val deviceId = store.credentials()?.optString("device_id")

    fun refresh(): JSONObject {
        val previous = store.snapshot()
        val value = request("snapshot")
        check(store.credentials()?.optString("device_id") == deviceId) {
            "The watch connection changed. Open Noted again."
        }
        store.saveSnapshot(value)
        if (signature(previous) != signature(value)) SurfaceUpdates.request(context)
        WatchPush.configure(context, value.optJSONObject("firebase"))
        return value
    }

    private fun signature(value: JSONObject?): String {
        if (value == null) return ""
        val copy = JSONObject(value.toString())
        copy.optJSONObject("tracker")?.apply {
            remove("server_time")
            remove("elapsed_seconds")
        }
        return copy.toString()
    }

    fun request(
        path: String,
        body: JSONObject? = null,
        method: String = if (body == null) "GET" else "POST",
    ): JSONObject {
        val credentials =
            store.credentials()
                ?: error("Pair your watch from Noted Settings > Watch on your phone.")
        check(credentials.optString("device_id") == deviceId) {
            "The watch connection changed. Try again."
        }
        return try {
            WatchHttp.request(
                credentials.getString("origin"),
                "/api/v1/wear/$path",
                method,
                body,
                credentials.getString("secret"),
            )
        } catch (error: WatchHttpException) {
            if (error.status == 401) {
                store.clear()
                SurfaceUpdates.request(context)
            }
            throw error
        }
    }
}
