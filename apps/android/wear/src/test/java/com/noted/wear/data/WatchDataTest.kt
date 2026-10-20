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
}
