package com.noted.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.*
import com.noted.android.features.ai.*
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAssistantTest {
    @Test fun rewritesRetryWithoutDuplicatesAndPreserveConcurrentEdits() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("nativeParity") == "true")
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NotedApplication
        val repository = app.repository
        repository.logout()
        repository.login("http://localhost:8123", "native", "native-test-password-only")
        val channel = JSONArray(repository.api.request("/channels")).objects().first { it.text("name") == "little-thoughts" }
        val message = JSONObject(repository.mutate("/channels/${channel.text("id")}/messages", body = json("content" to "Before a rewrite")))
        val id = message.text("id")
        val context = json("channel_id" to channel.text("id"), "message_ids" to JSONArray(listOf(id)))
        val rewrite = listOf(json("id" to id, "text" to "Reviewed rewrite"))
        try {
            applyAssistantRewrites(repository, context, rewrite, mapOf(id to "Before a rewrite"))
            applyAssistantRewrites(repository, context, rewrite, mapOf(id to "Before a rewrite"))
            assertEquals("Reviewed rewrite", currentAssistantMessage(repository, context, id).text("content"))
            assertEquals(1, JSONArray(repository.api.request("/messages/$id/versions")).length())
            repository.mutate("/messages/$id", "PUT", json("content" to "Edited on another device", "expected_content" to "Reviewed rewrite"))
            try {
                applyAssistantRewrites(repository, context, listOf(json("id" to id, "text" to "Stale suggestion")), mapOf(id to "Reviewed rewrite"))
                fail("A stale rewrite must not replace a newer edit")
            } catch (expected: IllegalStateException) {
                assertTrue(expected.message!!.contains("changed since you reviewed"))
            }
            assertEquals("Edited on another device", currentAssistantMessage(repository, context, id).text("content"))
        } finally { repository.mutate("/messages/$id", "DELETE") }
    }
}
