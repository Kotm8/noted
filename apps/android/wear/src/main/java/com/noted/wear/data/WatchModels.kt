package com.noted.wear.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

data class TrackedActivity(val id: String, val name: String, val icon: String)

data class Tracker(
    val revision: Int,
    val activeActivityId: String?,
    val pausedActivityId: String?,
    val elapsedSeconds: Long,
    val serverTime: Instant,
) {
    val running: Boolean
        get() = activeActivityId != null

    fun elapsed(now: Long = System.currentTimeMillis()): Long =
        elapsedSeconds + if (running) maxOf(0, (now - serverTime.toEpochMilli()) / 1000) else 0
}

data class Prompt(
    val id: String,
    val revision: Int,
    val planId: String,
    val activityId: String,
    val title: String,
    val phase: String,
    val status: String,
    val plannedStart: Instant,
    val plannedEnd: Instant?,
    val notifyAt: Instant,
) {
    val ended: Boolean
        get() = phase == "end"
}

data class Plan(
    val id: String,
    val title: String,
    val activityId: String,
    val startAt: Instant,
    val endAt: Instant,
    val timezone: String,
)

data class Reminder(
    val messageId: String,
    val revision: Int,
    val content: String,
    val dueAt: Instant,
    val workspaceName: String,
    val channelName: String,
)

data class Preferences(
    val accent: String,
    val textScale: Float,
    val favorites: List<String>,
    val hideContents: Boolean,
)

/** The server's watch snapshot, parsed once so screens never read raw JSON. */
data class Snapshot(
    val tracker: Tracker,
    val activities: List<TrackedActivity>,
    val prompts: List<Prompt>,
    val plans: List<Plan>,
    val reminders: List<Reminder>,
    val preferences: Preferences,
    val snoozeMinutes: Int,
) {
    val current: TrackedActivity?
        get() =
            (tracker.activeActivityId ?: tracker.pausedActivityId)?.let { id ->
                activities.find { it.id == id }
            }

    fun prompt(id: String) = prompts.find { it.id == id }

    fun plan(id: String) = plans.find { it.id == id }

    fun reminder(id: String) = reminders.find { it.messageId == id }

    fun upcomingPlans(now: Instant = Instant.now()) =
        plans.filter { it.endAt.isAfter(now) }.sortedBy { it.startAt }

    companion object {
        fun parse(json: JSONObject): Snapshot {
            val tracker = json.getJSONObject("tracker")
            val board = json.optJSONObject("board") ?: JSONObject()
            val settings = json.optJSONObject("settings") ?: JSONObject()
            return Snapshot(
                tracker =
                    Tracker(
                        revision = tracker.optInt("revision", 1),
                        activeActivityId =
                            tracker.optJSONObject("active")?.optString("activity_id"),
                        pausedActivityId = tracker.text("paused_activity_id"),
                        elapsedSeconds = tracker.optLong("elapsed_seconds"),
                        serverTime = instant(tracker.optString("server_time")) ?: Instant.now(),
                    ),
                activities =
                    objects(json.optJSONArray("activities")).map {
                        TrackedActivity(
                            it.getString("id"),
                            it.optString("name"),
                            it.optString("icon"),
                        )
                    },
                prompts = objects(json.optJSONArray("prompts")).map(::prompt),
                plans =
                    objects(board.optJSONArray("plans")).map {
                        Plan(
                            id = it.getString("id"),
                            title = it.optString("title"),
                            activityId = it.optString("activity_id"),
                            startAt = Instant.parse(it.getString("start_at")),
                            endAt = Instant.parse(it.getString("end_at")),
                            timezone = it.optString("timezone", "UTC"),
                        )
                    },
                reminders =
                    objects(board.optJSONArray("reminders")).map {
                        Reminder(
                            messageId = it.getString("message_id"),
                            revision = it.optInt("revision", 1),
                            content = it.optString("content"),
                            dueAt = Instant.parse(it.getString("due_at")),
                            workspaceName = it.optString("workspace_name"),
                            channelName = it.optString("channel_name"),
                        )
                    },
                preferences =
                    Preferences(
                        accent = settings.optString("accent", "#e2c15a"),
                        textScale =
                            settings.optDouble("text_scale", 1.0).toFloat().coerceIn(.85f, 1.3f),
                        favorites =
                            settings.optJSONArray("favorites")?.let { array ->
                                (0 until array.length()).map { array.getString(it) }
                            } ?: emptyList(),
                        hideContents = settings.optBoolean("hide_contents"),
                    ),
                snoozeMinutes =
                    json.optJSONObject("notifications")?.optInt("snooze_minutes", 10) ?: 10,
            )
        }

        fun prompt(json: JSONObject) =
            Prompt(
                id = json.getString("id"),
                revision = json.optInt("revision", 1),
                planId = json.optString("plan_id"),
                activityId = json.optString("activity_id"),
                title = json.optString("title"),
                phase = json.optString("phase", "start"),
                status = json.optString("status", "pending"),
                plannedStart =
                    instant(json.optString("planned_start"))
                        ?: instant(json.optString("start_at"))
                        ?: Instant.EPOCH,
                plannedEnd = instant(json.text("planned_end")),
                notifyAt = instant(json.optString("notify_at")) ?: Instant.EPOCH,
            )

        private fun objects(array: JSONArray?): List<JSONObject> =
            if (array == null) emptyList()
            else (0 until array.length()).map { array.getJSONObject(it) }

        private fun instant(value: String?): Instant? =
            value?.takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it) }.getOrNull() }

        private fun JSONObject.text(key: String): String? =
            if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
    }
}
