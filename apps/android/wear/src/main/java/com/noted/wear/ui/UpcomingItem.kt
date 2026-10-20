package com.noted.wear.ui

import com.noted.wear.data.WatchData
import java.time.Instant
import org.json.JSONObject

data class UpcomingItem(
    val kind: String,
    val value: JSONObject,
    val title: String,
    val subtitle: String,
    val at: Instant,
) {
    companion object {
        fun from(snapshot: JSONObject): List<UpcomingItem> {
            val prompts = WatchData.items(snapshot.optJSONArray("prompts"))
            val promptPlans = prompts.map { it.optString("plan_id") }.toSet()
            val active =
                prompts.map {
                    UpcomingItem(
                        "prompt",
                        it,
                        it.optString("title"),
                        "Activity prompt",
                        Instant.parse(it.getString("notify_at")),
                    )
                }
            val plans =
                WatchData.plans(snapshot)
                    .filter { it.optString("id") !in promptPlans }
                    .map {
                        UpcomingItem(
                            "plan",
                            it,
                            it.optString("title"),
                            WatchData.time(it.getString("start_at"), it.getString("timezone")),
                            Instant.parse(it.getString("start_at")),
                        )
                    }
            val reminders =
                WatchData.items(snapshot.getJSONObject("board").optJSONArray("reminders")).map {
                    UpcomingItem(
                        "reminder",
                        it,
                        it.optString("content").take(100).ifBlank { "Reminder" },
                        "${WatchData.time(it.getString("due_at"))} / ${it.optString("channel_name")}",
                        Instant.parse(it.getString("due_at")),
                    )
                }
            return (active + plans + reminders).sortedBy { it.at }
        }
    }
}
