package com.noted.android.connection

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun acceptsOnlyHttpsOrigins() {
        assertEquals("https://notes.example.com", ServerAddress.normalize(" Notes.Example.com/ "))
        assertEquals("https://notes.example.com:8443", ServerAddress.normalize("https://notes.example.com:8443"))
        listOf("http://example.com", "https://user:pass@example.com", "https://example.com/login", "https://example.com?x=1", "https://example.com#x", "file:///etc/passwd", "https://example.com:99999").forEach {
            assertTrue(it, runCatching { ServerAddress.normalize(it) }.isFailure)
        }
    }

    @Test fun checksExactOriginBeforeOpeningNotificationOrPassingCookies() {
        val origin = "https://notes.example.com"
        assertTrue(ServerAddress.owns(origin, "$origin/w/project/c/channel?note=123"))
        assertTrue(ServerAddress.owns(origin, "$origin:443/api/v1/files/123"))
        listOf("https://notes.example.com.evil.com", "https://evil.com", "https://notes.example.com:8443", "http://notes.example.com", "https://user@notes.example.com", "javascript:alert(1)").forEach {
            assertFalse(it, ServerAddress.owns(origin, it))
        }
    }
}
