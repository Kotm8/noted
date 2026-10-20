package com.noted.wear.data

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import org.json.JSONArray
import org.json.JSONObject

object WatchData {
    fun items(array: JSONArray?): List<JSONObject> =
        if (array == null) emptyList() else (0 until array.length()).map { array.getJSONObject(it) }

    fun time(value: String, timezone: String = ZoneId.systemDefault().id): String =
        runCatching {
                DateTimeFormatter.ofPattern("HH:mm")
                    .withZone(ZoneId.of(timezone))
                    .format(Instant.parse(value))
            }
            .getOrDefault("--:--")

    fun elapsed(snapshot: JSONObject, now: Long = System.currentTimeMillis()): Long {
        val tracker = snapshot.getJSONObject("tracker")
        val synced = Instant.parse(tracker.getString("server_time")).toEpochMilli()
        return tracker.optLong("elapsed_seconds") +
            if (tracker.optJSONObject("active") != null) maxOf(0, (now - synced) / 1000) else 0
    }

    fun duration(seconds: Long): String =
        "%02d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)

    fun current(snapshot: JSONObject): JSONObject? {
        val tracker = snapshot.getJSONObject("tracker")
        val id =
            tracker.optJSONObject("active")?.optString("activity_id")
                ?: tracker.optString("paused_activity_id")
        return items(snapshot.optJSONArray("activities")).find { it.optString("id") == id }
    }

    fun plans(snapshot: JSONObject): List<JSONObject> =
        items(snapshot.getJSONObject("board").optJSONArray("plans"))
            .filter { Instant.parse(it.getString("end_at")).isAfter(Instant.now()) }
            .sortedBy { it.getString("start_at") }
}
