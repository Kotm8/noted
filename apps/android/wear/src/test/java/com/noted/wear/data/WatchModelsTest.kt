package com.noted.wear.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchModelsTest {
    private val now = Instant.parse("2026-10-28T10:00:00Z")

    private fun prompt(status: String, notifyAt: Instant = now.minusSeconds(60)) =
        Prompt(
            id = "prompt",
            revision = 2,
            planId = "plan",
            activityId = "writing",
            title = "Deep work",
            phase = "start",
            status = status,
            plannedStart = now.minusSeconds(120),
            plannedEnd = now.plusSeconds(3600),
            notifyAt = notifyAt,
        )

    private fun plan(start: Instant) =
        Plan("plan", "Deep work", "writing", start, start.plusSeconds(3600), "UTC")

    @Test
    fun aWaitingPromptStillApplies() {
        assertNull(PromptOutcome.classify(prompt("pending"), emptyList(), now))
    }

    @Test
    fun explainsWhyAPromptNoLongerApplies() {
        assertEquals(
            OutdatedReason.Started,
            PromptOutcome.classify(prompt("started"), emptyList(), now)?.reason,
        )
        assertEquals(
            OutdatedReason.Stopped,
            PromptOutcome.classify(prompt("stopped"), emptyList(), now)?.reason,
        )
        val delayed =
            PromptOutcome.classify(prompt("pending", now.plusSeconds(600)), emptyList(), now)
        assertEquals(OutdatedReason.Delayed, delayed?.reason)
        assertEquals(now.plusSeconds(600), delayed?.at)
    }

    @Test
    fun aCancelledPromptWasMovedWhenItsPlanRunsAtAnotherTime() {
        val later = now.plusSeconds(4 * 3600)
        val moved = PromptOutcome.classify(prompt("cancelled"), listOf(plan(later)), now)
        assertEquals(OutdatedReason.Moved, moved?.reason)
        assertEquals(later, moved?.at)
        val ended = PromptOutcome.classify(prompt("superseded"), emptyList(), now)
        assertEquals(OutdatedReason.Ended, ended?.reason)
        assertEquals(now.plusSeconds(3600), ended?.at)
    }

    @Test
    fun parsesTheServerSnapshot() {
        val json =
            JSONObject()
                .put(
                    "tracker",
                    JSONObject()
                        .put("revision", 4)
                        .put("active", JSONObject().put("activity_id", "writing"))
                        .put("paused_activity_id", JSONObject.NULL)
                        .put("elapsed_seconds", 90)
                        .put("server_time", now.toString()),
                )
                .put(
                    "activities",
                    JSONArray()
                        .put(
                            JSONObject()
                                .put("id", "writing")
                                .put("name", "Writing")
                                .put("icon", "Pen"),
                        ),
                )
                .put(
                    "prompts",
                    JSONArray()
                        .put(
                            JSONObject()
                                .put("id", "prompt")
                                .put("plan_id", "plan")
                                .put("activity_id", "writing")
                                .put("title", "Deep work")
                                .put("planned_start", now.toString())
                                .put("planned_end", JSONObject.NULL)
                                .put("phase", "start")
                                .put("notify_at", now.toString())
                                .put("status", "pending")
                                .put("revision", 2),
                        ),
                )
                .put(
                    "board",
                    JSONObject()
                        .put("plans", JSONArray())
                        .put(
                            "reminders",
                            JSONArray()
                                .put(
                                    JSONObject()
                                        .put("message_id", "message")
                                        .put("revision", 1)
                                        .put("content", "Drink water")
                                        .put("due_at", now.toString())
                                        .put("workspace_name", "Personal")
                                        .put("channel_name", "daily"),
                                ),
                        ),
                )
                .put(
                    "settings",
                    JSONObject()
                        .put("text_scale", 2.0)
                        .put("favorites", JSONArray().put("writing")),
                )
                .put("notifications", JSONObject().put("snooze_minutes", 15))
        val snapshot = Snapshot.parse(json)
        assertEquals("Writing", snapshot.current?.name)
        assertEquals(150, snapshot.tracker.elapsed(now.plusSeconds(60).toEpochMilli()))
        assertNull(snapshot.prompt("prompt")?.plannedEnd)
        assertEquals("Drink water", snapshot.reminder("message")?.content)
        assertEquals(1.3f, snapshot.preferences.textScale)
        assertEquals(listOf("writing"), snapshot.preferences.favorites)
        assertEquals(15, snapshot.snoozeMinutes)
    }
}
