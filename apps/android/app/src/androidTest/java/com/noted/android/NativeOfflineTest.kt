package com.noted.android

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.SecretStore
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeOfflineTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun opensSavedChannelWithoutWaitingForTheServerAndKeepsAnUnsentMessage() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val repository = (context.applicationContext as NotedApplication).repository
        assumeTrue(InstrumentationRegistry.getArguments().getString("nativeOffline") == "true" && repository.session.value?.origin == "http://localhost:8123")
        assertNotNull(SecretStore(context).read())
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            compose.waitUntil(5000) { compose.onAllNodesWithContentDescription("Open sidebar").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Open sidebar").performClick()
            val start = System.nanoTime()
            compose.onNodeWithText("little-thoughts").performClick()
            compose.waitUntil(1500) {
                var found = false
                scenario.onActivity { activity ->
                    fun visit(view: View) {
                        if (view is TextView && view.text.toString().contains("A quiet place for the things worth keeping.")) found = true
                        if (view is ViewGroup) for (index in 0 until view.childCount) visit(view.getChildAt(index))
                    }
                    visit(activity.window.decorView)
                }
                found
            }
            assertTrue("The cached channel waited for the network.", (System.nanoTime() - start) / 1_000_000 < 1500)
            compose.onNodeWithContentDescription("Message #little-thoughts").performTextInput("Queued while the server was unavailable")
            compose.onNodeWithContentDescription("Send note").performClick()
            compose.waitUntil(5000) { repository.pending.value.any { it.body.optString("content") == "Queued while the server was unavailable" } }
            compose.onNodeWithText("Waiting to send").assertIsDisplayed()
            assertNotNull(SecretStore(context).read())
        }
    }
}
