package com.noted.wear.ui

import com.noted.wear.data.WatchData
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

object WatchUiFixtures {
    const val PROMPT_ID = "3f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c"
    const val OLD_PROMPT_ID = "4a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d"
    private val now = Instant.now()

    fun planTime() = WatchData.time(now.plusSeconds(1800).toString(), "Europe/Moscow")

    fun reminderTime() = WatchData.time(now.plusSeconds(900).toString())

    fun prompt() =
        plan(PROMPT_ID, "Walk outside", 1800)
            .put("plan_id", "walk")
            .put("activity_id", "walk")
            .put("revision", 1)
            .put("notify_at", now.toString())
            .put("planned_start", now.plusSeconds(1800).toString())

    fun snapshot(): JSONObject {
        val plans =
            JSONArray()
                .put(plan("deep", "Deep work", -1800, 5400))
                .put(plan("walk", "Walk outside", 1800))
                .put(plan("read", "Reading", 7200))
        return JSONObject()
            .put(
                "settings",
                JSONObject()
                    .put("face", "W16")
                    .put("accent", "#e2c15a")
                    .put("text_scale", 1.0)
                    .put("schedule_hours", 4),
            )
            .put(
                "tracker",
                JSONObject()
                    .put("server_time", now.toString())
                    .put("elapsed_seconds", 1470)
                    .put("revision", 1)
                    .put("active", JSONObject().put("activity_id", "build")),
            )
            .put(
                "activities",
                JSONArray()
                    .put(activity("build", "Building Noted", "Code2"))
                    .put(activity("walk", "Walking", "Footprints"))
                    .put(
                        activity("read", "Reading a longer book about how things work", "BookOpen"),
                    ),
            )
            .put("prompts", JSONArray())
            .put("notifications", JSONObject().put("snooze_minutes", 10))
            .put(
                "board",
                JSONObject()
                    .put("plans", plans)
                    .put(
                        "reminders",
                        JSONArray()
                            .put(
                                JSONObject()
                                    .put("message_id", "reminder")
                                    .put("revision", 1)
                                    .put("content", "Drink water")
                                    .put("due_at", now.plusSeconds(900).toString())
                                    .put("workspace_name", "Personal")
                                    .put("channel_name", "daily"),
                            ),
                    )
                    .put(
                        "sessions",
                        JSONArray()
                            .put(
                                JSONObject()
                                    .put("activity_id", "build")
                                    .put("started_at", now.minusSeconds(1470).toString())
                                    .put("ended_at", JSONObject.NULL),
                            ),
                    ),
            )
    }

    private fun activity(id: String, name: String, icon: String) =
        JSONObject().put("id", id).put("name", name).put("icon", icon).put("color", "#e2c15a")

    private fun plan(id: String, title: String, seconds: Long, length: Long = 1800) =
        JSONObject()
            .put("id", id)
            .put("title", title)
            .put("activity_id", id)
            .put("timezone", "Europe/Moscow")
            .put("start_at", now.plusSeconds(seconds).toString())
            .put("end_at", now.plusSeconds(seconds + length).toString())
}
