package com.noted.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WatchDataTest {
    @Test
    fun formatsLongRunningSessions() {
        assertEquals("00:00:00", WatchData.duration(0))
        assertEquals("01:01:01", WatchData.duration(3661))
        assertEquals("25:00:00", WatchData.duration(90000))
    }

    @Test
    fun uses24HourTimeAndTimezone() {
        assertEquals("23:15", WatchData.time("2026-10-20T20:15:00Z", "Europe/Moscow"))
        assertEquals("--:--", WatchData.time("invalid", "UTC"))
    }

    @Test
    fun acceptsOnlyHttpsOriginsWithoutCredentialsOrPaths() {
        assertEquals("https://notes.example.com", WatchHttp.origin("https://notes.example.com"))
        listOf(
                "http://notes.example.com",
                "https://user:secret@notes.example.com",
                "https://notes.example.com/path",
                "https://notes.example.com?token=x",
                "https://notes.example.com#token",
            )
            .forEach { value ->
                assertThrows(IllegalArgumentException::class.java) { WatchHttp.origin(value) }
            }
    }

    @Test
    fun countsTodaysTrackedTimeFromMidnight() {
        val now = java.time.Instant.parse("2026-10-28T10:00:00Z")
        val snapshot =
            org.json.JSONObject()
                .put(
                    "board",
                    org.json.JSONObject()
                        .put(
                            "sessions",
                            org.json.JSONArray()
                                .put(session("2026-10-27T23:00:00Z", "2026-10-28T01:00:00Z"))
                                .put(session("2026-10-28T09:30:00Z", null)),
                        ),
                )
        assertEquals(5400, WatchData.trackedToday(snapshot, now, java.time.ZoneOffset.UTC))
        assertEquals("1h 30m", WatchData.hours(5400))
        assertEquals("45m", WatchData.hours(2700))
    }

    @Test
    fun findsThePlanRunningNow() {
        val now = java.time.Instant.parse("2026-10-28T10:00:00Z")
        val board =
            org.json.JSONObject()
                .put(
                    "plans",
                    org.json.JSONArray()
                        .put(plan("later", "2026-10-28T11:00:00Z", "2026-10-28T12:00:00Z"))
                        .put(plan("now", "2026-10-28T09:30:00Z", "2026-10-28T11:00:00Z")),
                )
        val snapshot = org.json.JSONObject().put("board", board)
        assertEquals("now", WatchData.currentPlan(snapshot, now)?.getString("id"))
        assertEquals(
            null,
            WatchData.currentPlan(snapshot, java.time.Instant.parse("2026-10-28T13:00:00Z")),
        )
    }

    private fun session(start: String, end: String?) =
        org.json.JSONObject()
            .put("started_at", start)
            .put("ended_at", end ?: org.json.JSONObject.NULL)

    private fun plan(id: String, start: String, end: String) =
        org.json.JSONObject().put("id", id).put("start_at", start).put("end_at", end)
}
