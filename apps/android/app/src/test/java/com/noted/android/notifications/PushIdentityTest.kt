package com.noted.android.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushIdentityTest {
    @Test
    fun acceptsOnlyTheSelectedServerAndItsFirebaseSender() {
        val server = "https://notes.example.com"
        assertTrue(
            PushIdentity.accepts(
                server,
                server,
                "project-one",
                "123",
                server,
                "project-one",
                "123",
            ),
        )
        assertFalse(
            PushIdentity.accepts(
                "https://other.example.com",
                server,
                "project-one",
                "123",
                server,
                "project-one",
                "123",
            ),
        )
        assertFalse(
            PushIdentity.accepts(
                server,
                server,
                "project-one",
                "123",
                "https://other.example.com",
                "project-one",
                "123",
            ),
        )
        assertFalse(
            PushIdentity.accepts(
                server,
                server,
                "project-one",
                "123",
                server,
                "project-two",
                "123",
            ),
        )
        assertFalse(
            PushIdentity.accepts(
                server,
                server,
                "project-one",
                "123",
                server,
                "project-one",
                "999",
            ),
        )
        assertFalse(
            PushIdentity.accepts(server, server, "project-one", "123", server, "project-one", null),
        )
    }
}
