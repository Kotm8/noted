package com.noted.android

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeCacheTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun cachedContentDraftsAndQueuedMessagesSurviveDatabaseReopening() {
        val account = "fixture-${UUID.randomUUID()}"
        LocalStore(context).use { store ->
            store.save(account, "/channels/a/messages", "{\"items\":[{\"content\":\"Keep this\"}]}")
            store.saveDraft(account, "/channels/a/messages", "An unfinished thought")
            store.enqueue(account, "stable-client-id", "/channels/a/messages", json("content" to "Send once", "client_id" to "stable-client-id"))
        }
        LocalStore(context).use { reopened ->
            assertTrue(reopened.cached(account, "/channels/a/messages")!!.contains("Keep this"))
            assertEquals("An unfinished thought", reopened.draft(account, "/channels/a/messages"))
            assertEquals("stable-client-id", reopened.pending(account).single().body.text("client_id"))
            reopened.failPending(account, "stable-client-id", "This channel was deleted.")
            assertEquals("This channel was deleted.", reopened.pending(account).single().error)
            reopened.clear(account)
            assertNull(reopened.cached(account, "/channels/a/messages"))
            assertTrue(reopened.pending(account).isEmpty())
            assertEquals("", reopened.draft(account, "/channels/a/messages"))
        }
    }

    @Test fun accountsAndServersNeverShareCachedContent() {
        val suffix = UUID.randomUUID().toString()
        val first = "https://one.example|owner-$suffix"
        val second = "https://two.example|owner-$suffix"
        val otherOwner = "https://one.example|other-$suffix"
        LocalStore(context).use { store ->
            try {
                store.save(first, "/home/activity", "first")
                assertNull(store.cached(second, "/home/activity"))
                assertNull(store.cached(otherOwner, "/home/activity"))
                store.save(second, "/home/activity", "second")
                store.clear(first)
                assertNull(store.cached(first, "/home/activity"))
                assertEquals("second", store.cached(second, "/home/activity"))
            } finally { store.clear(first); store.clear(second); store.clear(otherOwner) }
        }
    }

    @Test fun sessionCredentialsAreProtectedByTheAndroidKeystore() {
        val name = "native-test-${UUID.randomUUID()}"
        val store = SecretStore(context, name)
        try {
            store.write("a-private-session-token")
            assertEquals("a-private-session-token", SecretStore(context, name).read())
            assertFalse(context.getSharedPreferences(name, Context.MODE_PRIVATE).all.toString().contains("a-private-session-token"))
            store.clear()
            assertNull(store.read())
        } finally { store.clear() }
    }
}
